# 📋 Acceptable Use Policy

Real Browser MCP Server is a Model Context Protocol (MCP) server that provides AI agents with a reliable, controlled web browser for automation and testing. This document outlines the acceptable use of this software.

## ✅ Intended Uses

This tool is designed for **legitimate, authorized** automation and testing workflows, including:

- **Quality Assurance (QA)**: Automated testing of web applications you own or are authorized to test.
- **Accessibility Automation**: Assisting with accessibility audits and automation for compliance.
- **Development & Debugging**: Reproducing user flows, capturing network traffic, and debugging web applications.
- **Authorized Research**: Security research, academic study, and compliance audits on systems you own or have explicit permission to test.
- **Content Extraction**: Extracting publicly available data in compliance with the target site's Terms of Service and applicable laws (e.g., robots.txt, rate limits).
- **Form & Workflow Automation**: Automating repetitive browser workflows on systems you are authorized to access.

## ⛔ Prohibited Uses

This software must **not** be used to:

- Circumvent security controls, bot-detection systems, or access restrictions on systems you do not own or are not authorized to access.
- Engage in fraud, impersonation, account takeover, or unauthorized access to third-party accounts.
- Violate any applicable law, regulation, or third-party Terms of Service.
- Distribute spam, malware, or engage in denial-of-service activity.
- Scrape or extract data from sources where such activity is explicitly prohibited.
- Bypass CAPTCHA or similar challenges on systems without explicit authorization from the system owner.

## 🔐 CAPTCHA & Bot-Detection Notes

- The `solve_captcha` tool is intended to **assist** with CAPTCHA challenges on systems you are authorized to access (e.g., your own QA environments). It does not automatically solve reCAPTCHA or hCaptcha — those require third-party services and explicit authorization.
- The `deep_analysis` tool reports bot-detection signals (Cloudflare, DataDome, reCAPTCHA presence) for **diagnostic and compliance** purposes, so you can verify whether your automation is operating within the target's acceptable use.

## 📜 Compliance Responsibility

Users of this software are solely responsible for ensuring their use complies with:

1. All applicable local, national, and international laws.
2. The Terms of Service of any website or service accessed.
3. Rate limits, robots.txt directives, and access controls of target systems.
4. Any contractual obligations or organizational policies.

The maintainers of Real Browser MCP Server do not endorse or support any use of this software that violates laws, regulations, or third-party rights.

## 🤝 Reporting Misuse

If you become aware of misuse of this software, please report it to the repository maintainers via GitHub Issues. We are committed to promoting ethical and responsible use of automation tools.

## 📧 Contact

For questions about this policy or acceptable use, please open an issue at [https://github.com/codeiva4u/Real-Browser-Mcp-Server/issues](https://github.com/codeiva4u/Real-Browser-Mcp-Server/issues).