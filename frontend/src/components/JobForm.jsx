import { useState } from "react";
import {createJob, getQueues} from "../api";

function JobForm({projects,onJobCreated}) {
    const [queues, setQueues] =
        useState([]);

    const [form, setForm] = useState({
        project_id: "",
        queue_id: "",
        name: "",
        job_type: "immediate",
        payload: ""
    });
    const [delaySeconds, setDelaySeconds] = useState(0);

    async function loadQueues(projectId) {
        if (!projectId) {
            setQueues([]);
            return;
        }

        try {
            const response =await getQueues(projectId);
            setQueues(response.data);
        } catch (error) {
            console.error(error);
        }
    }

    function handleProjectChange(e) {
        const projectId = e.target.value;
        setForm({
            ...form,
            project_id: projectId,
            queue_id: ""
        });
        loadQueues(projectId);
    }

    function handleChange(e) {
        setForm({ ...form,[e.target.name]:e.target.value
        });
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!form.queue_id) {
            alert("Please select a queue");
            return;
        }

        let payload = {};
        try {
            payload = form.payload
                ? JSON.parse(form.payload)
                : {};
        } catch {
            alert("Payload must be valid JSON");
            return;
        }

        try {
            let runAt = null;
            if (
                form.job_type === "delayed" &&
                delaySeconds > 0
            ) {
                runAt = new Date(
                    Date.now() + delaySeconds * 1000
                ).toISOString();
            }

            let parsedPayload;
            try {
                parsedPayload = JSON.parse(form.payload);

                if (
                    parsedPayload === null ||
                    typeof parsedPayload !== "object" ||
                    Array.isArray(parsedPayload)
                ) {
                    throw new Error("Payload must be a JSON object.");
                }
            } catch (error) {
                setError(error.message || "Enter valid JSON.");
                return;
            }

            await createJob({
                queue_id: Number(form.queue_id),
                name: form.name,
                job_type: form.job_type,
                payload: payload,
                run_at: runAt
            });

            setForm({
                project_id: "",
                queue_id: "",
                name: "",
                job_type: "immediate",
                payload: ""
            });

            setDelaySeconds(0);
            setQueues([]);
            onJobCreated();

        } catch (error) {
            alert(
                error.response?.data?.error ||
                "Failed to create job"
            );
        }
    }

    return (
        <form
            onSubmit={handleSubmit}
            style={styles.form}
        >
            <select
                value={form.project_id}
                onChange={
                    handleProjectChange
                }
                style={styles.input}
                required
            >
                <option value="">Select Project</option>

                {projects.map(project => (
                    <option
                        key={project.id}
                        value={project.id}
                    >
                        {project.name}
                    </option>
                ))}
            </select>

            <select
                name="queue_id"
                value={form.queue_id}
                onChange={handleChange}
                style={styles.input}
                required
            >
                <option value="">Select Queue</option>

                {queues.map(queue => (
                    <option
                        key={queue.id}
                        value={queue.id}
                    >
                        {queue.name}
                    </option>
                ))}
            </select>

            <input
                name="name"
                placeholder="Job name"
                value={form.name}
                onChange={handleChange}
                style={styles.input}
                required
            />

            <select
                name="job_type"
                value={form.job_type}
                onChange={handleChange}
                style={styles.input}
            >
                <option value="immediate">Immediate</option>
                <option value="delayed">Delayed</option>
                <option value="scheduled">Scheduled</option>
                <option value="recurring">Recurring</option>
                <option value="batch">Batch</option>
            </select>

            {form.job_type === "delayed" && (
                <input
                    type="number"
                    min="1"
                    placeholder="Delay in seconds"
                    value={delaySeconds}
                    onChange={e =>
                        setDelaySeconds(
                            Number(e.target.value)
                        )
                    }
                    style={styles.input}
                />
            )}
            <textarea
                name="payload"
                placeholder='Payload JSON e.g. {"message":"Hello"}'
                value={form.payload}
                onChange={handleChange}
                style={styles.textarea}
            />

            <button
                type="submit"
                style={styles.button}
            >
                Create Job
            </button>
        </form>
    );
}

const styles = {
    form: {
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        maxWidth: "600px"
    },

    input: {
        padding: "11px",
        border: "1px solid #ddd",
        borderRadius: "6px"
    },

    textarea: {
        minHeight: "100px",
        padding: "11px",
        border: "1px solid #ddd",
        borderRadius: "6px",
        fontFamily: "monospace"
    },

    button: {
        padding: "11px",
        border: "none",
        borderRadius: "6px",
        background: "#2563eb",
        color: "white",
        cursor: "pointer"
    }
};

export default JobForm;