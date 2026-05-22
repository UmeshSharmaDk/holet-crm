import app from "./app";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Strictly required for Render

app.listen(PORT as number, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});
