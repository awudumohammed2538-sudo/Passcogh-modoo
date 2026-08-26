const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve the website files from the public folder
app.use(express.static(path.join(__dirname, "../public")));

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "PASSCOGH-MODOO backend is running"
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`PASSCOGH-MODOO running on port ${PORT}`);
});
