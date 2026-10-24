import { useEffect, useMemo, useState } from "react";
import {
    getProjects,
    getDatasets,
    getQueues,
    createQueue,
    createJob
} from "../api";

export default function NewExperiment({ onExperimentSubmitted }) {
    const [projects, setProjects] = useState([]);
    const [datasets, setDatasets] = useState([]);
    const [queues, setQueues] = useState([]);

    const [projectId, setProjectId] = useState("");
    const [datasetId, setDatasetId] = useState("");
    const [queueId, setQueueId] = useState("");
    const [target, setTarget] = useState("");
    const [algorithm, setAlgorithm] = useState("Random Forest");
    const [name, setName] = useState("");

    const [loadingProjects, setLoadingProjects] = useState(true);
    const [loadingResources, setLoadingResources] = useState(false);
    const [saving, setSaving] = useState(false);
    const [creatingQueue, setCreatingQueue] = useState(false);

    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [submittedJobId, setSubmittedJobId] = useState(null);

    useEffect(() => {
        let cancelled = false;

        async function loadProjects() {
            setLoadingProjects(true);

            try {
                const response = await getProjects();

                if (cancelled) return;

                const loadedProjects = Array.isArray(response.data)
                    ? response.data
                    : [];

                setProjects(loadedProjects);

                if (loadedProjects.length > 0) {
                    setProjectId(String(loadedProjects[0].id));
                }
            } catch (err) {
                if (!cancelled) {
                    setError(
                        err.response?.data?.error ||
                        "Could not load projects. Please refresh and try again."
                    );
                }
            } finally {
                if (!cancelled) setLoadingProjects(false);
            }
        }

        loadProjects();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        async function loadProjectResources() {
            if (!projectId) {
                setDatasets([]);
                setQueues([]);
                setDatasetId("");
                setQueueId("");
                setTarget("");
                return;
            }

            setLoadingResources(true);
            setError("");
            setMessage("");
            setSubmittedJobId(null);

            setDatasets([]);
            setQueues([]);
            setDatasetId("");
            setQueueId("");
            setTarget("");

            try {
                const [datasetResponse, queueResponse] = await Promise.all([
                    getDatasets(projectId),
                    getQueues(projectId)
                ]);

                if (cancelled) return;

                const loadedDatasets = Array.isArray(datasetResponse.data)
                    ? datasetResponse.data
                    : [];

                const loadedQueues = Array.isArray(queueResponse.data)
                    ? queueResponse.data
                    : [];

                setDatasets(loadedDatasets);
                setQueues(loadedQueues);

                if (loadedQueues.length > 0) {
                    setQueueId(String(loadedQueues[0].id));
                }
            } catch (err) {
                if (!cancelled) {
                    setError(
                        err.response?.data?.error ||
                        "Could not load this project's datasets and queues."
                    );
                }
            } finally {
                if (!cancelled) setLoadingResources(false);
            }
        }

        loadProjectResources();

        return () => {
            cancelled = true;
        };
    }, [projectId]);

    const selectedDataset = useMemo(
        () => datasets.find((dataset) =>
            String(dataset.id) === String(datasetId)
        ),
        [datasets, datasetId]
    );

    const columns = useMemo(() => {
        if (!selectedDataset) return [];

        if (Array.isArray(selectedDataset.columns)) {
            return selectedDataset.columns;
        }

        if (Array.isArray(selectedDataset.columns_json)) {
            return selectedDataset.columns_json;
        }

        if (typeof selectedDataset.columns_json === "string") {
            try {
                const parsed = JSON.parse(selectedDataset.columns_json);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }

        return [];
    }, [selectedDataset]);

    async function handleCreateQueue() {
        if (!projectId || creatingQueue) return;

        setCreatingQueue(true);
        setError("");
        setMessage("");

        try {
            await createQueue({
                project_id: Number(projectId),
                name: "Default Training Queue",
                priority: 1,
                concurrency_limit: 2,
                max_retries: 3,
                retry_strategy: "fixed",
                retry_delay: 5
            });

            const response = await getQueues(projectId);
            const loadedQueues = Array.isArray(response.data)
                ? response.data
                : [];

            setQueues(loadedQueues);

            if (loadedQueues.length > 0) {
                setQueueId(String(loadedQueues[0].id));
                setMessage("Training queue created successfully.");
            } else {
                setError(
                    "The queue creation request completed, but no queue was returned. Check the backend queue routes."
                );
            }
        } catch (err) {
            setError(
                err.response?.data?.error ||
                "Could not create a queue. Check the backend terminal."
            );
        } finally {
            setCreatingQueue(false);
        }
    }

    async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setMessage("");
    setSubmittedJobId(null);

    if (!projectId) {
        setError("Select a project first.");
        return;
    }

    if (!selectedDataset) {
        setError("Select a dataset.");
        return;
    }

    if (!queueId || !queues.some(
        (queue) => String(queue.id) === String(queueId)
    )) {
        setError("Select a valid queue for this project.");
        return;
    }

    if (!columns.includes(target)) {
        setError("Select a valid prediction target column.");
        return;
    }

    if (columns.length < 2) {
        setError("The selected dataset must contain at least two columns.");
        return;
    }

    setSaving(true);

    try {
        const response = await createJob({
            project_id: Number(projectId),
            queue_id: Number(queueId),
            name: name.trim() || `${algorithm} experiment`,
            job_type: "immediate",
            payload: {
                task: "ml_training",
                dataset_id: Number(selectedDataset.id),
                algorithm,
                target_column: target,
                task_type: "classification"
            }
        });

        const jobId = response.data?.job_id;

        setSubmittedJobId(jobId ?? null);
        setMessage(
            jobId
                ? `Experiment queued successfully. Job ID: ${jobId}.`
                : "Experiment submitted successfully."
        );

        setName("");

        if (onExperimentSubmitted) {
            await onExperimentSubmitted();
        }
    } catch (err) {
        console.error("Experiment submission failed:", err.response?.data || err);
        
        setError(
            err.response?.data?.error ||
            err.response?.data?.message ||
            "Could not submit the experiment. Check the backend and try again."
        );
    } finally {
        setSaving(false);
    }
}

    return (
        <section className="ml-panel">
            <div className="ml-panel-heading">
                <div>
                    <h3>Configure experiment</h3>
                    <p>
                        Select a project, dataset, prediction target and
                        machine-learning algorithm.
                    </p>
                </div>
            </div>

            {loadingProjects ? (
                <p className="ml-help">Loading your projects...</p>
            ) : projects.length === 0 ? (
                <div className="ml-empty">
                    <strong>No projects available</strong>
                    <p>Create a project from the dashboard before configuring an experiment.</p>
                </div>
            ) : (
                <form className="ml-upload-form" onSubmit={handleSubmit}>
                    <label htmlFor="experiment-name">Experiment name</label>
                    <input
                        id="experiment-name"
                        className="ml-experiment-input"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="e.g. Student pass prediction"
                        maxLength={150}
                    />

                    <label htmlFor="experiment-project">Project</label>
                    <select
                        id="experiment-project"
                        value={projectId}
                        onChange={(event) => setProjectId(event.target.value)}
                        required
                        disabled={saving || loadingResources}
                    >
                        <option value="">Select project</option>
                        {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                                {project.name}
                            </option>
                        ))}
                    </select>

                    <label htmlFor="experiment-dataset">Dataset</label>
                    <select
                        id="experiment-dataset"
                        value={datasetId}
                        onChange={(event) => {
                            setDatasetId(event.target.value);
                            setTarget("");
                            setError("");
                            setMessage("");
                        }}
                        required
                        disabled={loadingResources || datasets.length === 0}
                    >
                        <option value="">
                            {loadingResources
                                ? "Loading datasets..."
                                : datasets.length
                                    ? "Select dataset"
                                    : "No datasets in this project"}
                        </option>

                        {datasets.map((dataset) => (
                            <option key={dataset.id} value={dataset.id}>
                                {dataset.original_filename ||
                                    dataset.filename ||
                                    `Dataset ${dataset.id}`}
                            </option>
                        ))}
                    </select>

                    {selectedDataset && (
                        <p className="ml-help">
                            {selectedDataset.row_count ?? "Unknown"} rows ·{" "}
                            {columns.length} columns
                        </p>
                    )}

                    <label htmlFor="experiment-target">Prediction target</label>
                    <select
                        id="experiment-target"
                        value={target}
                        onChange={(event) => setTarget(event.target.value)}
                        required
                        disabled={!columns.length}
                    >
                        <option value="">
                            {columns.length
                                ? "Select target column"
                                : "Select a dataset first"}
                        </option>

                        {columns.map((column) => (
                            <option key={column} value={column}>
                                {column}
                            </option>
                        ))}
                    </select>

                    {selectedDataset && columns.length === 0 && (
                        <p className="ml-help">
                            Column names were not returned for this dataset.
                            Check the dataset API response.
                        </p>
                    )}

                    <label htmlFor="experiment-algorithm">Algorithm</label>
                    <select
                        id="experiment-algorithm"
                        value={algorithm}
                        onChange={(event) => setAlgorithm(event.target.value)}
                        disabled={saving}
                    >
                        <option>Random Forest</option>
                        <option>Decision Tree</option>
                        <option>Logistic Regression</option>
                        <option>K-Nearest Neighbors</option>
                    </select>

                    <label htmlFor="experiment-queue">Job queue</label>
                    <select
                        id="experiment-queue"
                        value={queueId}
                        onChange={(event) => setQueueId(event.target.value)}
                        required
                        disabled={loadingResources || queues.length === 0 || saving}
                    >
                        <option value="">
                            {loadingResources
                                ? "Loading queues..."
                                : queues.length
                                    ? "Select queue"
                                    : "No queue available"}
                        </option>

                        {queues.map((queue) => (
                            <option key={queue.id} value={queue.id}>
                                {queue.name || `Queue ${queue.id}`}
                            </option>
                        ))}
                    </select>

                    {!loadingResources && projectId && queues.length === 0 && (
                        <div className="ml-info-box">
                            <strong>This project needs a queue</strong>
                            <p>
                                Create a training queue before submitting an experiment.
                            </p>
                            <button
                                type="button"
                                className="ml-secondary-btn"
                                onClick={handleCreateQueue}
                                disabled={creatingQueue || saving}
                            >
                                {creatingQueue
                                    ? "Creating queue..."
                                    : "Create training queue"}
                            </button>
                        </div>
                    )}

                    <div className="ml-info-box">
                        <strong>How it works</strong>
                        <p>
                            Your experiment is added to the selected queue.
                            A running worker trains the model, evaluates its
                            performance and saves the results for comparison.
                        </p>
                    </div>

                    <button
                        type="submit"
                        className="ml-primary-btn"
                        disabled={
                            saving ||
                            loadingResources ||
                            !projectId ||
                            !selectedDataset ||
                            !target ||
                            !queueId
                        }
                    >
                        {saving ? "Submitting..." : "Submit experiment →"}
                    </button>

                    {error && (
                        <p className="ml-message" role="alert">
                            {error}
                        </p>
                    )}

                    {message && (
                        <p className="ml-message" role="status">
                            {message}
                        </p>
                    )}

                    {submittedJobId && (
                        <p className="ml-help">
                            Job #{submittedJobId} has been created. Its status
                            will change as the worker processes it.
                        </p>
                    )}
                </form>
            )}
        </section>
    );
}
