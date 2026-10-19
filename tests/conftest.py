import os
import pytest

# The legacy routing fixtures use fixed Manhattan coordinates. Keep them
# independent of the city selected by the local product launcher.
os.environ["FLOWSENSE_CITY"] = "manhattan"
from fastapi.testclient import TestClient
from src.main import app
from src.services.graph_service import graph_service

@pytest.fixture(scope="session", autouse=True)
def init_graph():
    graph_service.initialize()
    return graph_service

@pytest.fixture
def client():
    with TestClient(app, headers={"X-FlowSense-Key": "flowsense-operator-v1"}) as test_client:
        yield test_client
