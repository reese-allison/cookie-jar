import { createServer } from "node:http";
import { toNodeHandler } from "better-auth/node";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { auth } from "./auth";
import { jarRouter } from "./routes/jars";
import { noteRouter } from "./routes/notes";
import { roomRouter } from "./routes/rooms";
import { createSocketServer } from "./socket/server";

const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5175";

const app = express();
const httpServer = createServer(app);

app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  }),
);
app.use(cookieParser());

// better-auth handler — MUST be before express.json() per better-auth docs
app.all("/api/auth/{*splat}", toNodeHandler(auth));

app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Routes
app.use("/api/jars", jarRouter);
app.use("/api/notes", noteRouter);
app.use("/api/rooms", roomRouter);

// Socket.io
const io = createSocketServer(httpServer);

const PORT = process.env.PORT ?? 3001;

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { app, httpServer, io };
