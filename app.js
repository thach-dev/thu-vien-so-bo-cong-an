const express = require("express");
const cors = require("cors");

const app = express();


// =====================================================
// CORS
// =====================================================

app.use(
  cors({
    origin: "*",
    methods: [
      "GET",
      "POST",
      "PUT",
      "DELETE",
      "OPTIONS"
    ],
    allowedHeaders: [
      "Content-Type",
      "Authorization"
    ]
  })
);


// =====================================================
// BODY PARSER
// =====================================================

app.use(express.json());


// =====================================================
// ROUTES
// =====================================================

const authRoutes = require("./routes/auth");

app.use(
  "/api/auth",
  authRoutes
);


// =====================================================
// ROOT
// =====================================================

app.get("/", (req, res) => {

  res.status(200).json({
    message: "Backend is running"
  });

});


// =====================================================
// 404
// =====================================================

app.use((req, res) => {

  res.status(404).json({
    message: "API không tồn tại",
    path: req.originalUrl
  });

});


// =====================================================
// EXPORT
// =====================================================

module.exports = app;