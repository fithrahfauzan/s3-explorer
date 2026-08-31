.PHONY: install dev build clean docker-build docker-run

install:
	uv venv
	uv pip install -e .
	cd frontend && npm install

dev-backend:
	uv run uvicorn src.main:app --reload --port 8000

dev-frontend:
	cd frontend && npm run dev

dev:
	@echo "Run 'make dev-backend' and 'make dev-frontend' in separate terminals."

build:
	cd frontend && npm run build

clean:
	rm -rf .venv
	rm -rf frontend/dist
	rm -rf frontend/node_modules

docker-build:
	docker build -t s3-explorer .

docker-run:
	docker run -p 8000:8000 --env-file .env s3-explorer

docker-build-push:
	docker buildx build \
		--platform linux/amd64 \
		-t ffauzan/s3-explorer:latest \
		--push .