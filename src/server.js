import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || "*"
}));
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.json({
    name: "PASSCOGH-MODOO",
    status: "online",
    message: "PASSCOGH-MODOO backend is running."
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "PASSCOGH-MODOO API",
    status: "healthy"
  });
});

app.get("/api", (req, res) => {
  res.json({
    success: true,
    message: "Welcome to PASSCOGH-MODOO API",
    version: "2.0.0"
  });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "API route not found"
  });
});

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    success: false,
    message: "Internal server error"
  });
});

app.app.listen(PORT, "0.0.0.0", () => {

  console.log(`PASSCOGH-MODOO backend running on port ${PORT}`);
});
