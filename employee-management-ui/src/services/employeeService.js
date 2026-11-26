import api from './api';

export const getAllEmployees = async (params) => {
  const response = await api.get('/employees', { params });
  return response.data;
};

export const getEmployeeById = async (id) => {
  const response = await api.get(`/employees/${id}`);
  return response.data;
};

export const createEmployee = async (data) => {
  const response = await api.post('/employees', data);
  return response.data;
};

export const updateEmployee = async (id, data) => {
  const response = await api.put(`/employees/${id}`, data);
  return response.data;
};

export const deactivateEmployee = async (id) => {
  await api.patch(`/employees/${id}/deactivate`);
};
