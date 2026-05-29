import asyncio
import time
from typing import Optional, Dict
from concurrent.futures import Future


class TaskManager:
    def __init__(self):
        self._tasks: Dict[str, dict] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop

    def create_task(self, task_id: str):
        self._tasks[task_id] = {
            "id": task_id,
            "status": "pending",
            "start_time": time.time(),
            "result": None,
            "error": None,
            "cancelled": False
        }
        return self._tasks[task_id]

    def get_task(self, task_id: str) -> Optional[dict]:
        return self._tasks.get(task_id)

    def cancel_task(self, task_id: str) -> bool:
        task = self._tasks.get(task_id)
        if task and task["status"] in ["pending", "running"]:
            task["cancelled"] = True
            return True
        return False

    def complete_task(self, task_id: str, result: str = None, error: str = None):
        task = self._tasks.get(task_id)
        if task:
            if task["cancelled"]:
                task["status"] = "cancelled"
            else:
                task["status"] = "completed" if error is None else "failed"
            task["result"] = result
            task["error"] = error

    def is_cancelled(self, task_id: str) -> bool:
        task = self._tasks.get(task_id)
        return task is not None and task.get("cancelled", False)

    def cleanup_old_tasks(self, max_age: int = 60):
        current_time = time.time()
        to_remove = []
        for task_id, task in self._tasks.items():
            if current_time - task["start_time"] > max_age:
                to_remove.append(task_id)
        for task_id in to_remove:
            del self._tasks[task_id]


task_manager = TaskManager()
