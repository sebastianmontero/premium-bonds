mod common;
use common::*;

#[test]
fn test_initialize() {
    let (svm, admin) = setup_global_config();
    let (global_config, _) = global_config_pda();
    assert!(svm.get_account(&global_config).is_some());
    let _ = admin;
}

