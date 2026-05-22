import app from "./app";

const rawPort = process.env["PORT"];
const host = "0.0.0.0"; // Explicitly bind to all network interfaces

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Update the listen call to include the host
app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});