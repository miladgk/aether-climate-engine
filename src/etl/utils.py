import hashlib
from typing import Dict, Any

def _hash_pii(y: Dict[str, Any]) -> Dict[str, Any]:
    """
    Cryptographically hashes PII fields (user.id and user.ip_address) 
    using SHA-256 for GDPR compliance before flattening.
    """
    if 'user' in y:
        if 'id' in y['user']:
            user_id = str(y['user']['id']).encode('utf-8')
            y['user']['id'] = hashlib.sha256(user_id).hexdigest()
            
        if 'ip_address' in y['user']:
            ip_addr = str(y['user']['ip_address']).encode('utf-8')
            y['user']['ip_address'] = hashlib.sha256(ip_addr).hexdigest()
            
    return y

def _flatten_json(y: Dict[str, Any]) -> Dict[str, Any]:
    """
    Recursively flattens a nested JSON dictionary.
    """
    out = {}
    
    def flatten(x, name=''):
        if type(x) is dict:
            for a in x:
                flatten(x[a], name + a + '_')
        elif type(x) is list:
            i = 0
            for a in x:
                flatten(a, name + str(i) + '_')
                i += 1
        else:
            out[name[:-1]] = x
            
    flatten(y)
    return out
