const express = require("express");
const path = require("path");
const { randomUUID } = require("crypto");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const DATABASE_URL = process.env.DATABASE_URL || process.env.DB_URL;
const LOCAL_DB_USER = process.env.PGUSER || process.env.USER || process.env.LOGNAME;
const LOCAL_DB_NAME = process.env.PGDATABASE || "todo_app";
const MAINTENANCE_DB_NAME = process.env.PGMAINTENANCEDATABASE || "postgres";

function createPool(database = LOCAL_DB_NAME) {
    if (DATABASE_URL) {
        return new Pool({ connectionString: DATABASE_URL });
    }

    const config = {
        user: LOCAL_DB_USER,
        database,
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT) || 5432
    };

    if (process.env.PGPASSWORD) {
        config.password = process.env.PGPASSWORD;
    }

    return new Pool(
        config
    );
}

function quoteIdentifier(value) {
    return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

let pool = createPool();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const todoSelect = `
    SELECT
        id,
        text,
        completed,
        to_char(due_date, 'YYYY-MM-DD') AS "dueDate",
        to_char(due_time, 'HH24:MI') AS "dueTime",
        created_at AS "createdAt"
    FROM todos
`;

async function initDb() {
    try {
        await createTodosTable();
    } catch (error) {
        if (error.code !== "3D000" || DATABASE_URL) {
            throw error;
        }

        await pool.end();
        await createDatabase();
        pool = createPool();
        await createTodosTable();
    }
}

async function createDatabase() {
    const maintenancePool = createPool(MAINTENANCE_DB_NAME);

    try {
        await maintenancePool.query(`CREATE DATABASE ${quoteIdentifier(LOCAL_DB_NAME)}`);
    } finally {
        await maintenancePool.end();
    }
}

async function createTodosTable() {
    await pool.query(`
            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                text TEXT NOT NULL,
                completed BOOLEAN NOT NULL DEFAULT FALSE,
                due_date DATE,
                due_time TIME,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
}

function cleanTodo(body) {
    return {
        text: typeof body.text === "string" ? body.text.trim() : "",
        dueDate: body.dueDate || null,
        dueTime: body.dueTime || null,
        completed: Boolean(body.completed)
    };
}

app.get("/api/todos", async (req, res) => {
    try {
        const result = await pool.query(`${todoSelect} ORDER BY created_at DESC`);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to load todos" });
    }
});

app.post("/api/todos", async (req, res) => {
    const todo = cleanTodo(req.body);

    if (!todo.text) {
        res.status(400).json({ error: "Todo text is required" });
        return;
    }

    try {
        const result = await pool.query(
            `
                INSERT INTO todos (id, text, due_date, due_time)
                VALUES ($1, $2, $3, $4)
                RETURNING
                    id,
                    text,
                    completed,
                    to_char(due_date, 'YYYY-MM-DD') AS "dueDate",
                    to_char(due_time, 'HH24:MI') AS "dueTime",
                    created_at AS "createdAt"
            `,
            [randomUUID(), todo.text, todo.dueDate, todo.dueTime]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to create todo" });
    }
});

app.patch("/api/todos/:id", async (req, res) => {
    const todo = cleanTodo(req.body);

    if (!todo.text) {
        res.status(400).json({ error: "Todo text is required" });
        return;
    }

    try {
        const result = await pool.query(
            `
                UPDATE todos
                SET text = $2, completed = $3, due_date = $4, due_time = $5
                WHERE id = $1
                RETURNING
                    id,
                    text,
                    completed,
                    to_char(due_date, 'YYYY-MM-DD') AS "dueDate",
                    to_char(due_time, 'HH24:MI') AS "dueTime",
                    created_at AS "createdAt"
            `,
            [req.params.id, todo.text, todo.completed, todo.dueDate, todo.dueTime]
        );

        if (result.rowCount === 0) {
            res.status(404).json({ error: "Todo not found" });
            return;
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to update todo" });
    }
});

app.delete("/api/todos/:id", async (req, res) => {
    try {
        const result = await pool.query("DELETE FROM todos WHERE id = $1", [req.params.id]);

        if (result.rowCount === 0) {
            res.status(404).json({ error: "Todo not found" });
            return;
        }

        res.status(204).end();
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to delete todo" });
    }
});

app.put("/api/todos/restore", async (req, res) => {
    const todos = Array.isArray(req.body.todos) ? req.body.todos : [];
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await client.query("DELETE FROM todos");

        for (const item of todos) {
            const todo = cleanTodo(item);

            if (!item.id || !todo.text) continue;

            await client.query(
                `
                    INSERT INTO todos (id, text, completed, due_date, due_time, created_at)
                    VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()))
                `,
                [item.id, todo.text, todo.completed, todo.dueDate, todo.dueTime, item.createdAt || null]
            );
        }

        const result = await client.query(`${todoSelect} ORDER BY created_at DESC`);
        await client.query("COMMIT");
        res.json(result.rows);
    } catch (error) {
        await client.query("ROLLBACK");
        console.error(error);
        res.status(500).json({ error: "Failed to restore todos" });
    } finally {
        client.release();
    }
});

initDb()
    .then(() => {
        app.listen(PORT, HOST, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });
    })
    .catch((error) => {
        console.error("Could not connect to PostgreSQL.");
        console.error(
            DATABASE_URL
                ? "Check DATABASE_URL/DB_URL and make sure Postgres is running."
                : `Tried local database "${LOCAL_DB_NAME}" as user "${LOCAL_DB_USER}". Set DATABASE_URL, DB_URL, PGDATABASE, PGUSER, or PGPASSWORD if your Postgres uses different credentials.`
        );
        console.error(error);
        process.exit(1);
    });
