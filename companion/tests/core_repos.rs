//! `core::repos::lookup` on its own: folders with no repo.

use herdlingd::core::repos;

fn git_present() -> bool {
    std::process::Command::new("git").arg("--version").output().map(|o| o.status.success()).unwrap_or(false)
}

#[tokio::test]
async fn a_folder_that_does_not_exist_has_no_repo() {
    let dir = tempfile::tempdir().unwrap();
    let gone = dir.path().join("gone").to_string_lossy().into_owned();
    let r = repos::lookup(std::slice::from_ref(&gone)).await;
    assert_eq!(r.len(), 1);
    assert!(r[&gone].is_none());
}

#[tokio::test]
async fn a_folder_outside_any_repo_has_no_repo() {
    if !git_present() {
        eprintln!("skipped: git is not available");
        return;
    }
    let dir = tempfile::tempdir().unwrap();
    // Stop git from walking up to a repo above the temp folder.
    std::env::set_var("GIT_CEILING_DIRECTORIES", dir.path().parent().unwrap());
    let plain = dir.path().to_string_lossy().into_owned();
    let r = repos::lookup(std::slice::from_ref(&plain)).await;
    assert!(r[&plain].is_none());
}
