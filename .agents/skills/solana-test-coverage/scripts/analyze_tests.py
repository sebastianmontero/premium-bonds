import os
import re
import sys
import subprocess

def get_git_root():
    try:
        root = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], stderr=subprocess.DEVNULL)
        return root.decode('utf-8').strip()
    except Exception:
        # Fallback to scanning upward from __file__
        curr = os.path.dirname(os.path.abspath(__file__))
        while curr != os.path.dirname(curr):
            if os.path.exists(os.path.join(curr, '.git')) or os.path.exists(os.path.join(curr, 'anchor')):
                return curr
            curr = os.path.dirname(curr)
        return curr

GIT_ROOT = get_git_root()
INSTRUCTIONS_DIR = os.path.join(GIT_ROOT, "anchor/programs/anchor/src/instructions")
TESTS_DIR = os.path.join(GIT_ROOT, "anchor/programs/anchor/tests")

if not os.path.exists(INSTRUCTIONS_DIR):
    print(f"Error: Instruction directory not found at {INSTRUCTIONS_DIR}", file=sys.stderr)
    sys.exit(1)

if not os.path.exists(TESTS_DIR):
    print(f"Error: Test directory not found at {TESTS_DIR}", file=sys.stderr)
    sys.exit(1)

# Find all instruction files recursively
instruction_files = []
for root, dirs, files in os.walk(INSTRUCTIONS_DIR):
    for file in files:
        if file.endswith(".rs") and file != "mod.rs":
            instruction_files.append(os.path.join(root, file))

# Find all test files
test_files = []
for root, dirs, files in os.walk(TESTS_DIR):
    for file in files:
        if file.endswith(".rs") and file != "mod.rs":
            test_files.append(os.path.join(root, file))

def get_instruction_name(path):
    return os.path.basename(path).replace(".rs", "")

print(f"Scanning for PremiumBondsError coverage...")
print(f"Found {len(instruction_files)} instruction files and {len(test_files)} test files.\n")

report = []
any_uncovered = False

for inst_path in sorted(instruction_files):
    name = get_instruction_name(inst_path)
    rel_path = os.path.relpath(inst_path, INSTRUCTIONS_DIR)
    
    # Read instruction content
    with open(inst_path, "r") as f:
        content = f.read()
    
    # Find all PremiumBondsError references
    errors = set(re.findall(r"PremiumBondsError::([A-Za-z0-9_]+)", content))
    
    # Find corresponding test file(s)
    matching_tests = []
    for tf in test_files:
        tf_name = get_instruction_name(tf)
        if name in tf_name or tf_name == "integration" or (name == "claim_redemption" and "sell_bonds" in tf_name):
            matching_tests.append(tf)
            
    # For each matching test file, check if the error names are queried
    covered_errors = {}
    uncovered_errors = set(errors)
    test_methods = []
    
    for tf in matching_tests:
        with open(tf, "r") as f:
            tf_content = f.read()
        
        # Find test methods
        methods = re.findall(r"fn\s+(test_[A-Za-z0-9_]+)", tf_content)
        test_methods.extend(methods)
        
        for err in list(uncovered_errors):
            if err in tf_content:
                covered_errors[err] = os.path.basename(tf)
                uncovered_errors.remove(err)
                
    if len(uncovered_errors) > 0:
        any_uncovered = True
                
    report.append({
        "instruction": rel_path,
        "name": name,
        "errors_defined": sorted(list(errors)),
        "test_files": [os.path.basename(tf) for tf in matching_tests],
        "covered_errors": covered_errors,
        "uncovered_errors": sorted(list(uncovered_errors)),
        "test_methods": test_methods
    })

# Print report
for rep in report:
    print("=" * 80)
    print(f"Instruction: {rep['instruction']} ({rep['name']})")
    print(f"Test files: {', '.join(rep['test_files']) or 'NONE'}")
    print(f"Errors defined: {rep['errors_defined']}")
    print(f"Covered errors: {rep['covered_errors']}")
    if len(rep['uncovered_errors']) > 0:
        print(f"\033[91mUncovered errors: {rep['uncovered_errors']}\033[0m")
    else:
        print(f"Uncovered errors: {rep['uncovered_errors']}")
    print(f"Test methods ({len(rep['test_methods'])}): {rep['test_methods']}")
    print()

if any_uncovered:
    print("WARNING: There are uncovered error path validation guards in your tests.")
else:
    print("SUCCESS: All instruction error paths have verified test coverage.")
