import hashlib
from src.etl.utils import _hash_pii

def test_hash_pii_obfuscates_sensitive_fields():
    """
    Ensure that user.id and user.ip_address are cryptographically hashed 
    with SHA-256 and that non-PII fields remain intact.
    """
    raw_payload = {
        "event_id": "123e4567-e89b-12d3-a456-426614174000",
        "user": {
            "id": 12345,
            "ip_address": "192.168.1.50"
        },
        "event_type": "checkout",
        "metadata": {
            "browser": "Chrome"
        }
    }
    
    # Calculate expected hashes manually
    expected_id_hash = hashlib.sha256(b"12345").hexdigest()
    expected_ip_hash = hashlib.sha256(b"192.168.1.50").hexdigest()
    
    obfuscated = _hash_pii(raw_payload)
    
    # Assert PII is masked
    assert obfuscated["user"]["id"] == expected_id_hash
    assert obfuscated["user"]["ip_address"] == expected_ip_hash
    
    # Assert original values are NOT present
    assert obfuscated["user"]["id"] != 12345
    assert obfuscated["user"]["ip_address"] != "192.168.1.50"
    
    # Assert other data is untouched
    assert obfuscated["event_id"] == "123e4567-e89b-12d3-a456-426614174000"
    assert obfuscated["event_type"] == "checkout"

if __name__ == "__main__":
    test_hash_pii_obfuscates_sensitive_fields()
    print("SUCCESS: PII fields masked correctly!")
