# If a credential or incident image is exposed

1. Preserve relevant server, database and GitHub access logs privately before changing the system.
2. Restrict the exposed host or endpoint. Keep local campus operators informed if monitoring is interrupted.
3. Revoke or rotate the affected credential at its issuer. Update the local environment or device configuration and verify access again.
4. Identify which accounts, images and dates were affected using the preserved evidence. Do not publish incident data in GitHub issues.
5. Remove the exposed content and coordinate any Git history rewrite with collaborators. Deleting the current file alone does not revoke a credential.
6. Have the campus's responsible person determine any required notifications. Test the patched access boundary before reopening it.
