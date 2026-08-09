/**
 * Test Runner for All New Test Suites
 * Runs: Handler tests, Edge cases, Performance, Integration
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
};

function runTestSuite(name, pattern, description) {
  return new Promise((resolve, reject) => {
    console.log(`\n${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}🧪 ${name}${colors.reset}`);
    console.log(`${colors.dim}${description}${colors.reset}`);
    console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

    const startTime = Date.now();

    const proc = spawn('node', ['--test', pattern], {
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', (code) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      if (code === 0) {
        console.log(`\n${colors.green}✅ ${name} passed${colors.reset} ${colors.dim}(${duration}s)${colors.reset}`);
        resolve({ name, passed: true, duration });
      } else {
        console.log(`\n${colors.red}❌ ${name} failed${colors.reset} ${colors.dim}(exit code: ${code})${colors.reset}`);
        resolve({ name, passed: false, duration, exitCode: code });
      }
    });

    proc.on('error', (err) => {
      console.error(`${colors.red}Error running ${name}:${colors.reset}`, err.message);
      reject(err);
    });
  });
}

async function main() {
  console.log(`${colors.bright}${colors.cyan}\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}┃  Real Browser MCP - Comprehensive Test Suite  ┃${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${colors.reset}`);

  const suites = [
    {
      name: 'Handler Unit Tests',
      pattern: './test/handlers/*.test.mjs',
      description: 'Tests for browser, DOM, and extract handlers',
    },
    {
      name: 'Edge Case Tests',
      pattern: './test/handlers/edge-cases.test.mjs',
      description: 'Error scenarios, timeouts, race conditions',
    },
    {
      name: 'Performance Benchmarks',
      pattern: './test/performance/benchmarks.test.mjs',
      description: 'Execution times, memory usage, stability',
    },
    {
      name: 'Integration Tests',
      pattern: './test/integration/workflows.test.mjs',
      description: 'Multi-tool workflows and complex scenarios',
    },
  ];

  const results = [];
  const overallStart = Date.now();

  for (const suite of suites) {
    try {
      const result = await runTestSuite(suite.name, suite.pattern, suite.description);
      results.push(result);
    } catch (err) {
      results.push({ name: suite.name, passed: false, error: err.message });
    }
  }

  const overallDuration = ((Date.now() - overallStart) / 1000).toFixed(2);

  // Summary
  console.log(`\n${colors.bright}${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}📊 Test Summary${colors.reset}`);
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  results.forEach(result => {
    const icon = result.passed ? `${colors.green}✅` : `${colors.red}❌`;
    const status = result.passed ? `${colors.green}PASS` : `${colors.red}FAIL`;
    console.log(`${icon} ${result.name.padEnd(30)} ${status}${colors.reset} ${colors.dim}(${result.duration}s)${colors.reset}`);
  });

  console.log(`\n${colors.bright}Total:${colors.reset} ${total} suites`);
  console.log(`${colors.green}Passed:${colors.reset} ${passed}`);
  if (failed > 0) {
    console.log(`${colors.red}Failed:${colors.reset} ${failed}`);
  }
  console.log(`${colors.dim}Duration:${colors.reset} ${overallDuration}s\n`);

  // Exit code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, err);
  process.exit(1);
});
