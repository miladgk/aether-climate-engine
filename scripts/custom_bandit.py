import os
import ast
import sys

def scan_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    try:
        tree = ast.parse(content)
    except SyntaxError as e:
        print(f"[ERROR] Syntax error in {filepath}: {e}")
        return False

    vulnerabilities = []
    
    for node in ast.walk(tree):
        # Check for hardcoded credentials in assignments
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    var_name = target.id.lower()
                    if any(cred in var_name for cred in ['password', 'secret', 'key']):
                        if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                            vulnerabilities.append(f"Hardcoded credential assigned to '{target.id}' at line {node.lineno}")
        
        # Check for dangerous functions
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                if node.func.id in ['eval', 'exec']:
                    vulnerabilities.append(f"Dangerous function '{node.func.id}' called at line {node.lineno}")

    if vulnerabilities:
        print(f"[FAIL] {filepath}")
        for v in vulnerabilities:
            print(f"  -> {v}")
        return False
    else:
        print(f"[PASS] {filepath}: No vulnerabilities found.")
        return True

def run_scan(target_dir):
    print(f"Running static security scan (Custom Bandit Equivalent) on {target_dir}...\n")
    all_passed = True
    for root, _, files in os.walk(target_dir):
        for file in files:
            if file.endswith('.py'):
                filepath = os.path.join(root, file)
                if not scan_file(filepath):
                    all_passed = False
                    
    print("\nScan Complete.")
    if all_passed:
        print("Status: SECURE (No hardcoded credentials or dangerous functions found).")
    else:
        print("Status: VULNERABLE")
        sys.exit(1)

if __name__ == "__main__":
    run_scan("src/")
