import uuid
from datetime import datetime

from pydantic import BaseModel


class ReadReceiptRead(BaseModel):
    """既読者一覧の1件（誰がいつ読んだか, F-32）。"""

    user_id: uuid.UUID
    user_name: str
    user_email: str
    read_at: datetime
