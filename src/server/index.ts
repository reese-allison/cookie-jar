import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import { jarRouter } from "./routes/jars";
import { noteRouter } from "./routes/notes";
import { roomRouter } from "./routes/rooms";

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Routes
app.use("/api/jars", jarRouter);
app.use("/api/notes", noteRouter);
app.use("/api/rooms", roomRouter);

const PORT = process.env.PORT ?? 3001;

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { app, httpServer };
