import { createServer } from "node:http";
import { toNodeHandler } from "better-auth/node";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { auth } from "./auth";
import { jarRouter } from "./routes/jars";
import { noteRouter } from "./routes/notes";
import { roomRouter } from "./routes/rooms";
import { uploadRouter } from "./routes/uploads";
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

// Static files (uploads, sounds)
app.use("/uploads", express.static("public/uploads"));
app.use("/sounds", express.static("public/sounds"));

// Routes
app.use("/api/jars", jarRouter);
app.use("/api/notes", noteRouter);
app.use("/api/rooms", roomRouter);
app.use("/api/uploads", uploadRouter);

// Socket.io
const io = createSocketServer(httpServer);

const PORT = process.env.PORT ?? 3001;

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { app, httpServer, io };
