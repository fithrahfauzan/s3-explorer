# Build Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# Build Backend & Serve
FROM python:3.11-slim
WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Copy backend code and config
COPY pyproject.toml README.md ./
COPY src/ ./src/

# Install backend dependencies
RUN uv pip install --system -e .

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose port
EXPOSE 8000

# Command to run
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
