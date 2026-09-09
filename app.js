const express = require("express");
const app = express();

app.use(express.json());

// Import routes
const routes = require("./routes/index"); // hoặc require("./routes")

// Mount với tiền tố /api
app.use("/api", routes);

// Route xử lý lỗi 404 nếu không khớp URL nào
app.use((req, res) => {
  res.status(404).json({
    message: "API không tồn tại",
    path: req.originalUrl
  });
});

module.exports = app;