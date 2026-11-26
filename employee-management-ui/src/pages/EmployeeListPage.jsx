import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getAllEmployees,
  createEmployee,
  updateEmployee,
  deactivateEmployee,
} from '../services/employeeService';
import { getDepartments, createDepartment } from '../services/departmentService';

const STATUS_OPTIONS = ['ACTIVE', 'INACTIVE', 'ON_NOTICE', 'RESIGNED', 'TERMINATED'];
const EMPTY_FILTERS = { keyword: '', department: '', status: '' };
const EMPTY_FORM = {
  departmentId: '',
  employeeCode: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  dateOfBirth: '',
  gender: '',
  address: '',
  joiningDate: '',
  designation: '',
  salary: '',
};

const getErrorMessage = (err, fallback) =>
  err?.response?.data?.message || fallback;

const getStatusBadge = (status) => {
  switch (status) {
    case 'ACTIVE':
      return 'badge badge-success';
    case 'ON_NOTICE':
      return 'badge badge-warning';
    default:
      return 'badge badge-neutral';
  }
};

const toDateInput = (value) => (value ? String(value).slice(0, 10) : '');

const initialsOf = (first, last) =>
  `${(first || '').charAt(0)}${(last || '').charAt(0)}`.toUpperCase() || '?';

const Modal = ({ title, subtitle, onClose, children, footer, small }) => {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal-card${small ? ' modal-card-sm' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
};

const EmployeeListPage = () => {
  const { user } = useAuth();
  const canEdit = user?.role === 'ADMIN' || user?.role === 'HR';
  const canManageDepartments = user?.role === 'ADMIN';

  const [employees, setEmployees] = useState([]);
  const [totalElements, setTotalElements] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [applied, setApplied] = useState({ ...EMPTY_FILTERS });
  const [departments, setDepartments] = useState([]);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const [showDepartment, setShowDepartment] = useState(false);
  const [departmentName, setDepartmentName] = useState('');
  const [departmentDescription, setDepartmentDescription] = useState('');
  const [departmentError, setDepartmentError] = useState('');
  const [departmentBusy, setDepartmentBusy] = useState(false);

  const loadDepartments = useCallback(async () => {
    try {
      setDepartments(await getDepartments());
    } catch {
      // The employee list still works if department lookup fails.
    }
  }, []);

  useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAllEmployees({
        keyword: applied.keyword || undefined,
        department: applied.department || undefined,
        status: applied.status || undefined,
        page,
        size: 10,
      });
      setEmployees(data.content || []);
      setTotalElements(data.totalElements || 0);
      setTotalPages(data.totalPages || 0);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load employees.'));
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(0);
    setApplied({ ...filters });
  };

  const handleClearFilters = () => {
    setFilters({ ...EMPTY_FILTERS });
    setApplied({ ...EMPTY_FILTERS });
    setPage(0);
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, joiningDate: new Date().toISOString().slice(0, 10) });
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (employee) => {
    setEditing(employee);
    setForm({
      departmentId: employee.department?.id ? String(employee.department.id) : '',
      employeeCode: employee.employeeCode || '',
      firstName: employee.firstName || '',
      lastName: employee.lastName || '',
      email: employee.email || '',
      phone: employee.phone || '',
      dateOfBirth: toDateInput(employee.dateOfBirth),
      gender: employee.gender || '',
      address: employee.address || '',
      joiningDate: toDateInput(employee.joiningDate),
      designation: employee.designation || '',
      salary: employee.salary == null ? '' : String(employee.salary),
    });
    setFormError('');
    setShowForm(true);
  };

  const setFormField = (name) => (e) =>
    setForm((current) => ({ ...current, [name]: e.target.value }));

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!form.departmentId) {
      setFormError('Please select a department.');
      return;
    }

    const payload = {
      departmentId: Number(form.departmentId),
      employeeCode: form.employeeCode.trim(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      dateOfBirth: form.dateOfBirth || null,
      gender: form.gender || null,
      address: form.address.trim() || null,
      joiningDate: form.joiningDate,
      designation: form.designation.trim() || null,
      salary: form.salary === '' ? null : Number(form.salary),
    };

    setSaving(true);
    try {
      if (editing) {
        await updateEmployee(editing.id, payload);
        setNotice(`Updated ${payload.firstName} ${payload.lastName}.`);
      } else {
        await createEmployee(payload);
        setNotice(`Added ${payload.firstName} ${payload.lastName}.`);
      }
      setShowForm(false);
      await loadEmployees();
    } catch (err) {
      setFormError(getErrorMessage(err, 'Could not save the employee.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    try {
      await deactivateEmployee(deleting.id);
      setNotice(`${deleting.firstName} ${deleting.lastName} was deactivated.`);
      setDeleting(null);
      await loadEmployees();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not deactivate the employee.'));
      setDeleting(null);
    } finally {
      setDeletingBusy(false);
    }
  };

  const handleCreateDepartment = async (e) => {
    e.preventDefault();
    setDepartmentError('');
    if (!departmentName.trim()) {
      setDepartmentError('Department name is required.');
      return;
    }
    setDepartmentBusy(true);
    try {
      const created = await createDepartment({
        name: departmentName.trim(),
        description: departmentDescription.trim() || null,
      });
      await loadDepartments();
      setForm((current) => ({ ...current, departmentId: String(created.id) }));
      setShowDepartment(false);
      setDepartmentName('');
      setDepartmentDescription('');
      setNotice(`Department "${created.name}" created.`);
    } catch (err) {
      setDepartmentError(getErrorMessage(err, 'Could not create the department.'));
    } finally {
      setDepartmentBusy(false);
    }
  };

  return (
    <div className="employees-page">
      <div className="page-header page-header-row">
        <div>
          <h1>Employees</h1>
          <p>Search, add, and manage employee records.</p>
        </div>
        {canEdit && (
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            <span aria-hidden="true">＋</span> Add Employee
          </button>
        )}
      </div>

      {notice && <div className="alert alert-success">{notice}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      <form className="card filter-card" onSubmit={handleSearch}>
        <div className="filter-grid">
          <div className="form-group">
            <label className="form-label" htmlFor="employee-search">Search</label>
            <input
              id="employee-search"
              type="text"
              className="form-input"
              placeholder="Name, email, or code..."
              value={filters.keyword}
              onChange={(e) => setFilters({ ...filters, keyword: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="department-filter">Department</label>
            <select
              id="department-filter"
              className="form-select"
              value={filters.department}
              onChange={(e) => setFilters({ ...filters, department: e.target.value })}
            >
              <option value="">All departments</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.name}>{dept.name}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="status-filter">Status</label>
            <select
              id="status-filter"
              className="form-select"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </div>

          <div className="filter-actions">
            <button type="submit" className="btn btn-primary">Search</button>
            <button type="button" className="btn btn-secondary" onClick={handleClearFilters}>
              Clear
            </button>
          </div>
        </div>
      </form>

      <div className="results-meta">
        <span>
          {loading ? 'Loading employees...' : `${totalElements} employee${totalElements === 1 ? '' : 's'} found`}
        </span>
        {!loading && totalPages > 0 && (
          <span>Page {page + 1} of {totalPages}</span>
        )}
      </div>

      {loading ? (
        <div className="card">
          <div className="loading-state">Loading employees...</div>
        </div>
      ) : employees.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-state-icon" aria-hidden="true">⌕</div>
            <h3>No employees found</h3>
            <p>Try a different search, or clear the filters to see everyone.</p>
            <button type="button" className="btn btn-secondary btn-sm mt-4" onClick={handleClearFilters}>
              Clear filters
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Code</th>
                  <th>Email</th>
                  <th>Department</th>
                  <th>Designation</th>
                  <th>Status</th>
                  {canEdit && <th className="text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {employees.map((emp) => (
                  <tr key={emp.id}>
                    <td>
                      <div className="employee-cell">
                        <span className="avatar" aria-hidden="true">
                          {initialsOf(emp.firstName, emp.lastName)}
                        </span>
                        <span className="employee-name">
                          {emp.firstName} {emp.lastName}
                        </span>
                      </div>
                    </td>
                    <td><span className="mono">{emp.employeeCode}</span></td>
                    <td>{emp.email}</td>
                    <td>{emp.department?.name || '—'}</td>
                    <td>{emp.designation || '—'}</td>
                    <td>
                      <span className={getStatusBadge(emp.status)}>{emp.status || '—'}</span>
                    </td>
                    {canEdit && (
                      <td className="text-right">
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => openEdit(emp)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm btn-ghost-danger"
                            onClick={() => setDeleting(emp)}
                            disabled={emp.status === 'INACTIVE'}
                          >
                            Deactivate
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="table-footer">
            <span className="text-secondary">
              Showing {employees.length} of {totalElements}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setPage((p) => Math.max(p - 1, 0))}
                disabled={page === 0}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={page + 1 >= totalPages}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {showForm && (
        <Modal
          title={editing ? 'Edit employee' : 'Add employee'}
          subtitle={
            editing
              ? 'Email and employee code cannot be changed here.'
              : 'Add the employee record first, then the employee can create a login.'
          }
          onClose={() => setShowForm(false)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="submit" form="employee-form" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : editing ? 'Save changes' : 'Add employee'}
              </button>
            </>
          }
        >
          <form id="employee-form" onSubmit={handleFormSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label" htmlFor="emp-first">First name *</label>
                <input id="emp-first" className="form-input" required value={form.firstName} onChange={setFormField('firstName')} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-last">Last name *</label>
                <input id="emp-last" className="form-input" required value={form.lastName} onChange={setFormField('lastName')} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-email">Email *</label>
                <input id="emp-email" type="email" className="form-input" required value={form.email} onChange={setFormField('email')} disabled={Boolean(editing)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-code">Employee code *</label>
                <input id="emp-code" className="form-input" required value={form.employeeCode} onChange={setFormField('employeeCode')} disabled={Boolean(editing)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-dept">Department *</label>
                <div className="input-with-action">
                  <select id="emp-dept" className="form-select" required value={form.departmentId} onChange={setFormField('departmentId')}>
                    <option value="">Select department</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>{dept.name}</option>
                    ))}
                  </select>
                  {canManageDepartments && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowDepartment(true)}>
                      New
                    </button>
                  )}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-designation">Designation</label>
                <input id="emp-designation" className="form-input" value={form.designation} onChange={setFormField('designation')} placeholder="e.g. Developer" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-joining">Joining date *</label>
                <input id="emp-joining" type="date" className="form-input" required value={form.joiningDate} onChange={setFormField('joiningDate')} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-dob">Date of birth</label>
                <input id="emp-dob" type="date" className="form-input" value={form.dateOfBirth} onChange={setFormField('dateOfBirth')} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-phone">Phone</label>
                <input id="emp-phone" className="form-input" value={form.phone} onChange={setFormField('phone')} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-gender">Gender</label>
                <select id="emp-gender" className="form-select" value={form.gender} onChange={setFormField('gender')}>
                  <option value="">Not specified</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="emp-salary">Salary</label>
                <input id="emp-salary" type="number" min="1" step="1" className="form-input" value={form.salary} onChange={setFormField('salary')} placeholder="Optional" />
              </div>
              <div className="form-group form-grid-full">
                <label className="form-label" htmlFor="emp-address">Address</label>
                <textarea id="emp-address" className="form-textarea" value={form.address} onChange={setFormField('address')} />
              </div>
            </div>
            {formError && <div className="alert alert-error mb-0">{formError}</div>}
          </form>
        </Modal>
      )}

      {showDepartment && (
        <Modal
          title="New department"
          subtitle="Departments are used to group employees."
          small
          onClose={() => setShowDepartment(false)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setShowDepartment(false)}>Cancel</button>
              <button type="submit" form="department-form" className="btn btn-primary" disabled={departmentBusy}>
                {departmentBusy ? 'Creating...' : 'Create department'}
              </button>
            </>
          }
        >
          <form id="department-form" onSubmit={handleCreateDepartment}>
            <div className="form-group">
              <label className="form-label" htmlFor="dept-name">Name *</label>
              <input id="dept-name" className="form-input" required value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="dept-description">Description</label>
              <input id="dept-description" className="form-input" value={departmentDescription} onChange={(e) => setDepartmentDescription(e.target.value)} />
            </div>
            {departmentError && <div className="alert alert-error mb-0">{departmentError}</div>}
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal
          title="Deactivate employee"
          small
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setDeleting(null)}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={handleDeactivate} disabled={deletingBusy}>
                {deletingBusy ? 'Deactivating...' : 'Deactivate'}
              </button>
            </>
          }
        >
          <p>
            Deactivate <strong>{deleting.firstName} {deleting.lastName}</strong> ({deleting.employeeCode})?
          </p>
          <p className="text-secondary mt-2">
            Their status becomes INACTIVE and their login is disabled. Attendance and leave history are kept.
          </p>
        </Modal>
      )}
    </div>
  );
};

export default EmployeeListPage;
