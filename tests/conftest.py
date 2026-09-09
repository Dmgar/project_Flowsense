import pytest
from fastapi.testclient import TestClient
from src.main import app
from src.services.graph_service import graph_service

@pytest.fixture(scope="session", autouse=True)
def init_graph():
    graph_service.initialize()
    return graph_service

@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client
