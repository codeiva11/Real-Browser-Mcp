# Acceptable Use Policy

Real Browser MCP gives AI agents a real, controllable browser. With that
power comes responsibility.

## Intended Use

- QA and accessibility testing of pages you own or are authorized to test
- Automated form-filling and workflow verification on your own applications
- Authorized research, data collection, and scraping of public pages in
  compliance with the target site's Terms of Service and robots.txt
- Page analysis (SEO, performance, structure) for sites you operate or have
  permission to inspect

## Prohibited Use

- Circumventing access controls, rate limits, paywalls, or login gates you do
  not have authorization to pass
- Using the built-in verification-widget assistance against third-party
  services in violation of their terms
- Credential stuffing, account enumeration, or any abuse of authentication
  flows
- Extracting personal data without a lawful basis (GDPR/CCPA obligations apply)
- DDoS-style request flooding or any behavior that degrades a service
- Accessing internal/private networks unless you own them (the server blocks
  private-network targets by default via its SSRF guard)

## Operational Guidance

- Keep `REAL_BROWSER_ALLOW_PRIVATE_NETWORK` unset unless you genuinely need to
  reach local/private services, and set it only in trusted environments.
- `execute_js` runs arbitrary JavaScript inside a sandboxed browser tab. Only
  pass code from trusted sources.
- Respect each target site's documented automation policies. Being detected
  may result in your IP being blocked; this server does not attempt to evade
  blocks.
- Store credentials in environment variables or secret managers, never in tool
  arguments that could be logged.

Violations are the responsibility of the operator. This tool ships no warranty
and is provided for legitimate automation and testing workflows only.
