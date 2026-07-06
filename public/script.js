const form = document.getElementById("todoForm");
const input = document.getElementById("todoInput");
const dateInput = document.getElementById("dateInput");
const timeInput = document.getElementById("timeInput");
const undoButton = document.getElementById("undoButton");
const list = document.getElementById("todoList");
const summary = document.getElementById("summary");
const status = document.getElementById("status");

let todos = [];
let editingId = null;
let undoSnapshot = null;

function setStatus(message = "") {
    status.textContent = message;
}

function setUndoSnapshot() {
    undoSnapshot = todos.map((todo) => ({ ...todo }));
    undoButton.disabled = false;
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            ...options.headers
        },
        ...options
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Request failed");
    }

    if (response.status === 204) return null;

    return response.json();
}

function updateSummary() {
    const remaining = todos.filter((todo) => !todo.completed).length;
    const total = todos.length;

    if (total === 0) {
        summary.textContent = "No tasks yet";
        return;
    }

    summary.textContent = `${remaining} of ${total} tasks remaining`;
}

function formatDueDate(todo) {
    const parts = [];

    if (todo.dueDate) {
        parts.push(new Date(`${todo.dueDate}T00:00:00`).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric"
        }));
    }

    if (todo.dueTime) {
        parts.push(todo.dueTime);
    }

    return parts.join(" at ");
}

function renderTodos() {
    list.innerHTML = "";
    updateSummary();

    if (todos.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty-state";
        empty.textContent = "Add your first task above.";
        list.appendChild(empty);
        return;
    }

    todos.forEach((todo) => {
        const item = document.createElement("li");
        item.className = `todo-item${todo.completed ? " completed" : ""}`;

        const toggle = document.createElement("button");
        toggle.className = "toggle";
        toggle.type = "button";
        toggle.setAttribute("aria-label", todo.completed ? "Mark incomplete" : "Mark complete");
        toggle.addEventListener("click", () => toggleTodo(todo.id));

        const content = document.createElement("div");
        content.className = "todo-content";

        if (editingId === todo.id) {
            const editInput = document.createElement("input");
            editInput.className = "edit-input";
            editInput.value = todo.text;

            const editDate = document.createElement("input");
            editDate.className = "edit-date";
            editDate.type = "date";
            editDate.value = todo.dueDate || "";
            editDate.setAttribute("aria-label", "Edit task date");

            const editTime = document.createElement("input");
            editTime.className = "edit-time";
            editTime.type = "time";
            editTime.value = todo.dueTime || "";
            editTime.setAttribute("aria-label", "Edit task time");

            editInput.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    saveEdit(todo.id, editInput.value, editDate.value, editTime.value);
                }

                if (event.key === "Escape") {
                    editingId = null;
                    renderTodos();
                }
            });

            content.append(editInput, editDate, editTime);
        } else {
            const text = document.createElement("span");
            text.className = "todo-text";
            text.textContent = todo.text;
            content.appendChild(text);

            const dueText = formatDueDate(todo);

            if (dueText) {
                const due = document.createElement("span");
                due.className = "todo-due";
                due.textContent = dueText;
                content.appendChild(due);
            }
        }

        const actions = document.createElement("div");
        actions.className = "actions";

        const editButton = document.createElement("button");
        editButton.className = `action-button${editingId === todo.id ? " save-button" : ""}`;
        editButton.type = "button";
        editButton.textContent = editingId === todo.id ? "Save" : "Edit";
        editButton.addEventListener("click", () => {
            if (editingId === todo.id) {
                const editInput = content.querySelector(".edit-input");
                const editDate = content.querySelector(".edit-date");
                const editTime = content.querySelector(".edit-time");
                saveEdit(todo.id, editInput.value, editDate.value, editTime.value);
                return;
            }

            editingId = todo.id;
            renderTodos();
        });

        const deleteButton = document.createElement("button");
        deleteButton.className = "action-button delete-button";
        deleteButton.type = "button";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", () => deleteTodo(todo.id));

        actions.append(editButton, deleteButton);
        item.append(toggle, content, actions);
        list.appendChild(item);

        if (editingId === todo.id) {
            const editInput = content.querySelector(".edit-input");
            editInput.focus();
            editInput.setSelectionRange(editInput.value.length, editInput.value.length);
        }
    });
}

async function loadTodos() {
    try {
        setStatus("Loading...");
        todos = await requestJson("/api/todos");
        renderTodos();
        setStatus("");
    } catch (error) {
        setStatus(error.message);
    }
}

async function addTodo(text, dueDate, dueTime) {
    setUndoSnapshot();

    try {
        const todo = await requestJson("/api/todos", {
            method: "POST",
            body: JSON.stringify({ text, dueDate, dueTime })
        });

        todos = [todo, ...todos];
        renderTodos();
    } catch (error) {
        setStatus(error.message);
        undoSnapshot = null;
        undoButton.disabled = true;
    }
}

async function toggleTodo(id) {
    const todo = todos.find((item) => item.id === id);
    if (!todo) return;

    setUndoSnapshot();

    const nextTodo = {
        ...todo,
        completed: !todo.completed
    };

    try {
        const updated = await requestJson(`/api/todos/${id}`, {
            method: "PATCH",
            body: JSON.stringify(nextTodo)
        });

        todos = todos.map((item) => (item.id === id ? updated : item));
        renderTodos();
    } catch (error) {
        setStatus(error.message);
    }
}

async function saveEdit(id, text, dueDate, dueTime) {
    const nextText = text.trim();

    if (!nextText) return;

    const todo = todos.find((item) => item.id === id);
    if (!todo) return;

    setUndoSnapshot();

    try {
        const updated = await requestJson(`/api/todos/${id}`, {
            method: "PATCH",
            body: JSON.stringify({
                ...todo,
                text: nextText,
                dueDate: dueDate || null,
                dueTime: dueTime || null
            })
        });

        todos = todos.map((item) => (item.id === id ? updated : item));
        editingId = null;
        renderTodos();
    } catch (error) {
        setStatus(error.message);
    }
}

async function deleteTodo(id) {
    setUndoSnapshot();

    try {
        await requestJson(`/api/todos/${id}`, {
            method: "DELETE"
        });

        todos = todos.filter((todo) => todo.id !== id);
        renderTodos();
    } catch (error) {
        setStatus(error.message);
    }
}

async function undoLastChange() {
    if (!undoSnapshot) return;

    try {
        todos = await requestJson("/api/todos/restore", {
            method: "PUT",
            body: JSON.stringify({ todos: undoSnapshot })
        });
        undoSnapshot = null;
        undoButton.disabled = true;
        editingId = null;
        renderTodos();
    } catch (error) {
        setStatus(error.message);
    }
}

form.addEventListener("submit", (event) => {
    event.preventDefault();

    const text = input.value.trim();
    if (!text) return;

    addTodo(text, dateInput.value || null, timeInput.value || null);
    input.value = "";
    dateInput.value = "";
    timeInput.value = "";
    input.focus();
});

undoButton.addEventListener("click", undoLastChange);

loadTodos();

renderTodos();
