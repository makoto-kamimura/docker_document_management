import pytest

from app.core import crypto


def test_roundtrip():
    token = crypto.encrypt_json({"password": "秘密のパスワード"})
    assert "秘密" not in token
    assert crypto.decrypt_json(token) == {"password": "秘密のパスワード"}


def test_empty_token_is_empty_dict():
    assert crypto.decrypt_json(None) == {}


def test_missing_key(monkeypatch):
    monkeypatch.setattr(crypto.settings, "storage_secret_key", "")
    with pytest.raises(crypto.SecretKeyMissing):
        crypto.encrypt_json({"a": 1})


def test_wrong_key_cannot_decrypt(monkeypatch):
    token = crypto.encrypt_json({"a": 1})
    from cryptography.fernet import Fernet

    monkeypatch.setattr(crypto.settings, "storage_secret_key", Fernet.generate_key().decode())
    with pytest.raises(crypto.SecretKeyMissing):
        crypto.decrypt_json(token)
