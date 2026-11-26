import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const DOCS_DIR = path.resolve(REPO_ROOT, 'docs');

const BASE_URL = process.env.EMS_UI_URL || 'http://localhost:5173';
const API_BASE = process.env.EMS_API_URL || 'http://localhost:8080/api';
const ADMIN_EMAIL = process.env.EMS_ADMIN_EMAIL || 'admin@company.com';
const ADMIN_PASSWORD = process.env.EMS_ADMIN_PASSWORD || 'Admin@123';
const DEMO_PASSWORD = process.env.EMS_DEMO_PASSWORD || 'Demo@12345';
const BROWSER_CHANNEL = process.env.EMS_DEMO_BROWSER || '';

const VIDEO_WIDTH = 1280;
const VIDEO_HEIGHT = 800;
const GIF_WIDTH = 800;
const GIF_FPS = 6;

const shortId = Date.now().toString(36).toUpperCase().slice(-6);
const employeeCode = `DEMO-${shortId}`;
const employeeEmail = `demo.${shortId.toLowerCase()}@company.com`;
const departmentName = `Demo Engineering ${shortId}`;
const taskTitle = `Review onboarding checklist ${shortId}`;
const leaveReason = 'Demo leave request';

const today = new Date();
const joiningDate = toIsoDate(today);
const leaveStart = toIsoDate(addDays(today, 90));
const leaveEnd = toIsoDate(addDays(today, 91));
const taskDueDate = toIsoDate(addDays(today, 7));

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${url} failed: ${response.status} ${text}`);
  }

  return body;
}

async function ensureAppIsRunning() {
  try {
    const response = await fetch(BASE_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(
      `UI is not reachable at ${BASE_URL} (${error.message}). Start the app with run.ps1 first.`,
    );
  }
}

async function installOverlay(page) {
  await page.addStyleTag({
    content: `
      #ems-demo-caption {
        position: fixed;
        left: 50%;
        bottom: 28px;
        z-index: 2147483647;
        transform: translateX(-50%);
        max-width: 70vw;
        padding: 12px 22px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.92);
        color: #f8fafc;
        font: 600 16px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0.01em;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.3);
        pointer-events: none;
        opacity: 0;
        transition: opacity 220ms ease, transform 220ms ease;
      }
      #ems-demo-caption.show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      #ems-demo-badge {
        position: fixed;
        top: 18px;
        right: 22px;
        z-index: 2147483647;
        padding: 7px 13px;
        border-radius: 999px;
        background: #2563eb;
        color: white;
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0.12em;
        pointer-events: none;
        box-shadow: 0 6px 16px rgba(37, 99, 235, 0.35);
      }
      #ems-demo-cursor {
        position: fixed;
        top: -7px;
        left: -7px;
        z-index: 2147483647;
        width: 18px;
        height: 18px;
        border: 2px solid rgba(255, 255, 255, 0.95);
        border-radius: 50%;
        background: rgba(37, 99, 235, 0.85);
        box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
        pointer-events: none;
        transition: width 100ms ease, height 100ms ease;
      }
      #ems-demo-cursor.clicking {
        width: 26px;
        height: 26px;
        top: -11px;
        left: -11px;
      }
    `,
  });

  await page.evaluate(() => {
    const caption = document.createElement('div');
    caption.id = 'ems-demo-caption';
    document.body.appendChild(caption);

    const badge = document.createElement('div');
    badge.id = 'ems-demo-badge';
    badge.textContent = 'LIVE DEMO';
    document.body.appendChild(badge);

    const cursor = document.createElement('div');
    cursor.id = 'ems-demo-cursor';
    document.body.appendChild(cursor);

    document.addEventListener('mousemove', (event) => {
      cursor.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
    });

    document.addEventListener('mousedown', () => cursor.classList.add('clicking'));
    document.addEventListener('mouseup', () => cursor.classList.remove('clicking'));

    window.__emsDemoStep = (text) => {
      caption.textContent = text;
      caption.classList.remove('show');
      void caption.offsetWidth;
      caption.classList.add('show');
    };

    window.__emsDemoStep('Signing in as administrator');
  });
}

async function step(page, text, delay = 450) {
  console.log(`[demo] ${text}`);
  await page.evaluate((label) => window.__emsDemoStep?.(label), text);
  await page.waitForTimeout(delay);
}

async function click(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  }
  await locator.click();
}

async function type(locator, value, delay = 16) {
  await locator.fill('');
  await locator.pressSequentially(value, { delay });
}

async function waitForText(page, text, timeout = 30000) {
  await page.waitForFunction(
    (label) => document.body.innerText.includes(label),
    text,
    { timeout },
  );
}

async function loginAs(page, email, password) {
  console.log(`[demo] login as ${email}`);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await click(page, page.getByRole('button', { name: 'Login', exact: true }));
  await page.waitForURL('**/dashboard');
  await waitForText(page, 'Welcome back');
  console.log('[demo] login complete');
}

async function logout(page) {
  console.log('[demo] logout');
  await click(page, page.getByRole('button', { name: 'Logout' }));
  await page.waitForURL('**/login');
  console.log('[demo] logout complete');
}

async function createAdminTask() {
  console.log('[demo] seed demo task via API');
  const adminLogin = await requestJson(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });

  const headers = { Authorization: `Bearer ${adminLogin.token}` };
  const found = await requestJson(
    `${API_BASE}/employees?keyword=${encodeURIComponent(employeeCode)}`,
    { headers },
  );
  const employee = Array.isArray(found) ? found[0] : found.content?.[0];
  if (!employee?.id) throw new Error('Could not locate the demo employee through the API.');

  await requestJson(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: taskTitle,
      description: 'Created by the recorded demo script.',
      assignedToId: employee.id,
      priority: 'HIGH',
      dueDate: taskDueDate,
    }),
  });
  console.log('[demo] task seeded');
}

async function runDemo(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await installOverlay(page);

  await step(page, 'Admin signs in', 600);
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);

  await step(page, 'Admin dashboard shows live metrics', 1200);

  await step(page, 'Open the employee directory', 500);
  await click(page, page.getByRole('link', { name: 'Employees', exact: true }));
  await waitForText(page, 'Search, add, and manage employee records.');
  await page.waitForTimeout(700);

  await step(page, 'Create a department', 400);
  await click(page, page.getByRole('button', { name: /Add Employee/i }).first());
  await page.locator('#emp-first').waitFor({ state: 'visible' });
  await click(page, page.locator('.input-with-action button', { hasText: 'New' }));
  await page.locator('#dept-name').waitFor({ state: 'visible' });
  await type(page.locator('#dept-name'), departmentName);
  await type(page.locator('#dept-description'), 'Created by the recorded demo.');
  await click(page, page.locator('button[form="department-form"]'));
  await page.locator('#emp-dept option', { hasText: departmentName }).waitFor({ state: 'attached' });

  await step(page, 'Add a new employee', 400);
  await type(page.locator('#emp-first'), 'Demo');
  await type(page.locator('#emp-last'), 'Employee');
  await type(page.locator('#emp-email'), employeeEmail);
  await type(page.locator('#emp-code'), employeeCode);
  await page.locator('#emp-dept').selectOption({ label: departmentName });
  await type(page.locator('#emp-designation'), 'Demo Specialist');
  await type(page.locator('#emp-salary'), '75000');
  await click(page, page.locator('button[form="employee-form"]'));
  await waitForText(page, 'Added Demo Employee.');
  await page.waitForTimeout(700);

  await step(page, 'Search and edit the record', 400);
  await type(page.locator('#employee-search'), employeeCode);
  await click(page, page.locator('.filter-card button[type="submit"]'));
  await page.locator('tbody tr').filter({ hasText: employeeCode }).waitFor();

  let row = page.locator('tbody tr').filter({ hasText: employeeCode });
  await click(page, row.getByRole('button', { name: 'Edit' }));
  await page.locator('#emp-designation').waitFor({ state: 'visible' });
  await type(page.locator('#emp-designation'), 'Senior Demo Specialist');
  await click(page, page.locator('button[form="employee-form"]'));
  await waitForText(page, 'Updated Demo Employee.');
  await page.waitForTimeout(700);

  await step(page, 'Employee creates their own login', 400);
  await logout(page);
  await click(page, page.getByRole('link', { name: 'Register here' }));
  await page.waitForURL('**/register');
  await type(page.locator('#email'), employeeEmail);
  await type(page.locator('#password'), DEMO_PASSWORD);
  await click(page, page.getByRole('button', { name: 'Register', exact: true }));
  await waitForText(page, 'Registration successful.');
  await page.waitForURL('**/login');

  await createAdminTask();

  await step(page, 'Employee signs in to self-service', 500);
  await loginAs(page, employeeEmail, DEMO_PASSWORD);
  await page.waitForTimeout(900);

  await step(page, 'Check in and check out', 500);
  await click(page, page.getByRole('link', { name: 'Attendance', exact: true }));
  await waitForText(page, 'Attendance History');
  await click(page, page.getByRole('button', { name: 'Check In', exact: true }));
  await waitForText(page, 'Checked in successfully');
  await page.waitForTimeout(500);
  await click(page, page.getByRole('button', { name: 'Check Out', exact: true }));
  await waitForText(page, 'Checked out successfully');
  await page.waitForTimeout(800);

  await step(page, 'Apply for leave', 500);
  await click(page, page.getByRole('link', { name: 'Leave', exact: true }));
  await waitForText(page, 'Leave Management');
  await page.locator('form .form-select').selectOption('UNPAID');
  await page.locator('form input[type="date"]').nth(0).fill(leaveStart);
  await page.locator('form input[type="date"]').nth(1).fill(leaveEnd);
  await page.locator('form input[type="text"]').first().fill(leaveReason);
  console.log(`[demo] applying leave ${leaveStart} -> ${leaveEnd}`);
  await click(page, page.getByRole('button', { name: 'Apply', exact: true }));
  await waitForText(page, 'Leave applied successfully');
  await page.waitForTimeout(900);

  await step(page, 'Cancel the demo leave request', 500);
  const leaveRow = page.locator('tbody tr').filter({ hasText: leaveStart });
  await leaveRow.waitFor();
  await click(page, leaveRow.getByRole('button', { name: 'Cancel' }));
  await page.waitForTimeout(700);

  await step(page, 'Move an assigned task forward', 500);
  await click(page, page.getByRole('link', { name: 'Tasks', exact: true }));
  await waitForText(page, 'My Tasks');
  await page.locator('tbody tr').filter({ hasText: taskTitle }).waitFor();
  let taskRow = page.locator('tbody tr').filter({ hasText: taskTitle });
  await click(page, taskRow.getByRole('button', { name: /Mark as In Progress/i }));
  await page.waitForTimeout(700);
  taskRow = page.locator('tbody tr').filter({ hasText: taskTitle });
  await click(page, taskRow.getByRole('button', { name: /Mark as Completed/i }));
  await page.waitForTimeout(700);

  await step(page, 'Read notifications', 500);
  await click(page, page.getByRole('link', { name: 'Notifications', exact: true }));
  await waitForText(page, 'Notifications');
  await page.waitForTimeout(600);
  const markAll = page.getByRole('button', { name: 'Mark All as Read' });
  if (await markAll.count()) {
    await click(page, markAll);
    await waitForText(page, 'All caught up');
  }

  await step(page, 'Admin safely deactivates the demo employee', 500);
  await logout(page);
  await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await click(page, page.getByRole('link', { name: 'Employees', exact: true }));
  await waitForText(page, 'Search, add, and manage employee records.');
  await type(page.locator('#employee-search'), employeeCode);
  await click(page, page.locator('.filter-card button[type="submit"]'));
  row = page.locator('tbody tr').filter({ hasText: employeeCode });
  await row.waitFor();
  await click(page, row.getByRole('button', { name: 'Deactivate' }));
  await page.locator('.modal-card').getByText('Deactivate employee').waitFor();
  await click(page, page.locator('.modal-footer button.btn-danger'));
  await waitForText(page, 'was deactivated.');
  await page.waitForTimeout(1000);

  await step(page, 'Demo complete — real app, real database', 1200);
}

async function convertToGif(webmPath, gifPath) {
  const filter = [
    `fps=${GIF_FPS}`,
    `scale=${GIF_WIDTH}:-1:flags=lanczos`,
    'split[s0][s1]',
    '[s0]palettegen=max_colors=64:stats_mode=diff[p]',
    '[s1][p]paletteuse=dither=none',
  ].join(',');

  const result = spawnSync(
    ffmpegPath,
    ['-y', '-i', webmPath, '-vf', filter, '-loop', '0', gifPath],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    throw new Error(`GIF conversion failed:\n${result.stderr || result.stdout || 'unknown error'}`);
  }
}

async function main() {
  await ensureAppIsRunning();
  await fs.mkdir(DOCS_DIR, { recursive: true });

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ems-demo-'));
  const webmPath = path.join(DOCS_DIR, 'demo.webm');
  const gifPath = path.join(DOCS_DIR, 'demo.gif');

  let browser;
  let context;
  let video;
  let failure;

  try {
    browser = await chromium.launch({
      channel: BROWSER_CHANNEL || undefined,
      headless: true,
    });

    context = await browser.newContext({
      viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      recordVideo: {
        dir: tempDir,
        size: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      },
    });

    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(20000);
    video = page.video();
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[browser] ${message.text()}`);
    });
    page.on('pageerror', (error) => console.error(`[browser] ${error.message}`));
    page.on('response', (response) => {
      if (response.status() >= 400) {
        console.error(`[http] ${response.status()} ${response.request().method()} ${response.url()}`);
      }
    });

    await runDemo(page);
  } catch (error) {
    failure = error;
  } finally {
    if (context) await context.close().catch(() => {});
    if (video) await video.saveAs(webmPath).catch((error) => {
      if (!failure) failure = error;
    });
    await browser?.close();
  }

  if (failure) {
    throw failure;
  }

  await convertToGif(webmPath, gifPath);
  await fs.rm(tempDir, { recursive: true, force: true });

  console.log(`Recorded demo: ${webmPath}`);
  console.log(`README GIF:    ${gifPath}`);
  console.log(`Demo records:  ${employeeCode} / ${employeeEmail}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
