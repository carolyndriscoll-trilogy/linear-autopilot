# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Linear Autopilot, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email security concerns to: [your-email@example.com]
3. Include detailed steps to reproduce the vulnerability
4. Allow up to 48 hours for an initial response

We take security seriously and will work with you to address any legitimate concerns.

---

## Security Best Practices

Linear Autopilot requires several credentials with significant permissions. Follow these guidelines to maintain security.

### API Key Permissions

#### Linear API Key

**Minimum required scopes:**

- `read` — Read issues, labels, teams
- `write` — Update issue status, add comments
- `admin` — Not required

**Recommendations:**

- Create a dedicated service account for Autopilot
- Use team-scoped keys rather than workspace-wide when possible
- Rotate keys quarterly

#### GitHub Token

**Minimum required scopes:**

- `repo` — Full control of private repositories (required for PR creation)
- `workflow` — Update GitHub Action workflows (only if modifying workflows)

**Recommendations:**

- Use a [Fine-grained Personal Access Token](https://github.com/settings/tokens?type=beta) with repository-specific access
- Limit to only the repositories Autopilot manages
- Consider using a GitHub App for better auditability

#### Claude Code / Anthropic API

- Claude Code uses your authenticated Anthropic session
- Ensure your Anthropic account has appropriate usage limits set
- Monitor usage via the Anthropic Console

---

## Environment Security

### Secret Management

**DO:**

- Use environment variables for all secrets
- Use a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.) in production
- Encrypt secrets at rest
- Use different credentials for development and production

**DON'T:**

- Commit `.env` files to version control
- Log API keys or tokens
- Share credentials between environments
- Use production credentials for local development

### Deployment Security

```bash
# Example: Using Docker secrets
docker secret create linear_api_key ./linear_api_key.txt
docker secret create github_token ./github_token.txt
```

```yaml
# docker-compose.yml with secrets
services:
  autopilot:
    image: linear-autopilot
    secrets:
      - linear_api_key
      - github_token
    environment:
      - LINEAR_API_KEY_FILE=/run/secrets/linear_api_key
      - GITHUB_TOKEN_FILE=/run/secrets/github_token

secrets:
  linear_api_key:
    external: true
  github_token:
    external: true
```

---

## Network Security

### Webhook Security

If using Linear webhooks:

1. **Always verify webhook signatures:**

   ```typescript
   // The app already does this, but ensure LINEAR_WEBHOOK_SECRET is set
   const isValid = verifyWebhookSignature(payload, signature, secret);
   ```

2. **Use HTTPS only** — Never expose webhook endpoints over HTTP

3. **Restrict IP ranges** if your infrastructure supports it (Linear's IP ranges)

### Firewall Rules

Outbound connections required:

- `api.linear.app` (443) — Linear API
- `api.github.com` (443) — GitHub API
- `api.anthropic.com` (443) — Claude API

Inbound connections (if using webhooks):

- Port 3000 (or configured PORT) from Linear's IP ranges

---

## Audit & Monitoring

### Logging

The app uses structured JSON logging. Sensitive data is NOT logged, but verify:

```typescript
// Good: Log action without sensitive data
logger.info('PR created', { repo: 'org/repo', prNumber: 123 });

// Bad: Never log tokens
logger.info('Using token', { token: process.env.GITHUB_TOKEN }); // NEVER DO THIS
```

### Monitoring Recommendations

1. **Set up alerts for:**
   - Unusual API usage spikes
   - Failed authentication attempts
   - Agent failures or stuck agents

2. **Audit log retention:**
   - Keep logs for at least 90 days
   - Store in a secure, tamper-evident system

3. **Cost monitoring:**
   - Set Anthropic API usage alerts
   - Review `/dashboard/api/costs` regularly

---

## Agent Security

### Code Execution Boundaries

Claude Code agents execute in your repository directory. Consider:

1. **Repository isolation:**
   - Run Autopilot in a sandboxed environment (container, VM)
   - Use separate machines for sensitive repositories

2. **Branch protection:**
   - Require PR reviews before merging agent-created PRs
   - Enable branch protection rules on `main`

3. **Review generated code:**
   - Always review PRs before merging
   - Check for accidental secret exposure in generated code

### Preventing Prompt Injection

Ticket descriptions could theoretically contain malicious instructions. Mitigations:

- The agent prompt is designed to focus on implementation tasks
- Human review of PRs catches malicious code
- Consider sanitizing ticket descriptions if this is a concern

---

## Incident Response

If you suspect a security breach:

1. **Immediately rotate** all API keys and tokens
2. **Review** recent PRs created by Autopilot
3. **Check** Linear for unauthorized ticket modifications
4. **Audit** GitHub for unexpected repository access
5. **Review** Anthropic usage for anomalies

---

## Security Checklist

Before deploying to production:

- [ ] All secrets stored securely (not in code or `.env` in repo)
- [ ] Webhook signature verification enabled
- [ ] HTTPS configured for webhook endpoint
- [ ] GitHub branch protection enabled
- [ ] Fine-grained GitHub token with minimal permissions
- [ ] Linear API key scoped appropriately
- [ ] Monitoring and alerting configured
- [ ] Log retention policy in place
- [ ] Incident response plan documented
- [ ] Regular credential rotation scheduled

---

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

We recommend always using the latest version for security updates.
