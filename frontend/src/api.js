import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
    throw new Error("VITE_API_URL is missing from the production build");
}

const api = axios.create({
    baseURL: API_URL
});

export function setToken(token) {
    localStorage.setItem("token", token);
}
export function getToken() {
    return localStorage.getItem("token");
}
export function removeToken() {
    localStorage.removeItem("token");
}

api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem("token");
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

export const registerUser = (data) => api.post("/register", data);
export const loginUser = (data) => api.post("/login", data);
export const getProjects = () => api.get("/projects");
export const createProject = (data) => api.post("/projects", data);
export const getQueues = (projectId) => api.get(`/queues/${projectId}`);
export const createQueue = (data) => api.post("/queues", data);
export const getJobs = (params = {}) => api.get("/jobs", { params });
export const createJob = (data) => api.post("/jobs", data);
export const retryJob = (jobId) => api.post(`/jobs/${jobId}/retry`);
export const getJobDetails = (jobId) => api.get(`/jobs/${jobId}`);
export const getJobExecutions = (jobId) => api.get(`/jobs/${jobId}/executions`);
export const getJobLogs = (jobId) => api.get(`/jobs/${jobId}/logs`);
export const getDatasets = (projectId) => api.get("/datasets", {
    params: projectId ? { project_id: projectId } : {}
});
export const pauseQueue = (queueId) => api.patch(`/queues/${queueId}/pause`);
export const resumeQueue = (queueId) => api.patch(`/queues/${queueId}/resume`);
export const uploadDataset = (file, projectId) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("project_id", projectId);
    return api.post("/datasets/upload", formData);
};
export const getExperimentResults = () => api.get("/experiment-results");
export const getWorkers = () => api.get("/workers");

export default api;
