# Security Policy

## Reporting a vulnerability

Email [alexander@parabolic.io](mailto:alexander@parabolic.io) with the subject
`Banzai security report`. Please report suspected vulnerabilities privately
before opening a public issue or pull request containing exploit details.

Include the affected Banzai version or commit, operating system and Node
version, relevant client versions, a minimal reproduction, expected and
observed behavior, and the potential impact. Use a disposable repository and
synthetic data where possible. Do not send credentials, customer data, raw
`.banzai/runs/` directories, private source code, or complete model transcripts.
Start with a redacted description if the reproduction itself is sensitive.

The maintainer will assess reproducibility and impact and coordinate a fix and
disclosure when appropriate. This volunteer project does not promise a response
deadline, patch date, bug bounty, or long-term support period.

## Version scope

The initial public release is **2.2.0**. Security fixes target the latest public
release; older private releases and forks have no promised backport support.
If you find a problem on an older version, include that version in your report
even if you cannot test the latest release.

## Execution and data boundaries

Banzai launches local AI clients and repository-configured commands. Review
their permissions and configuration before running them on an untrusted
repository. Banzai's workflow gates supplement the host clients' permissions;
they are not an operating-system sandbox or proof that generated code is safe.

Project material supplied to an external client is subject to that client's
configuration and provider terms. Local run artifacts can still contain
sensitive project information despite redaction. Keep them private and share
only the minimum redacted evidence needed to reproduce a problem.

Do not test against other people's repositories, accounts, or systems without
authorization. For ordinary bugs and questions, use the
[public issue tracker](https://github.com/Parabolic-Technologies/banzai/issues).
