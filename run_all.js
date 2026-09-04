// Mavis Data Agent - 一键跑全部 8 步 (修复版)
const { execSync } = require('child_process');
const path = require('path');

const STEPS = [
  { name: 'Step 1: 数据生成', script: 'data/generate.js' },
  { name: 'Step 2: data-fetcher', script: 'tests/test_step2_fetcher.js' },
  { name: 'Step 3: 指标 catalog', script: 'tests/test_step3_catalog.js' },
  { name: 'Step 4: data-analyzer', script: 'tests/test_step4_analyzer.js' },
  { name: 'Step 5: data-validator', script: 'tests/test_step5_validator.js' },
  { name: 'Step 6: report-builder', script: 'tests/test_step6_report.js' },
  { name: 'Step 7: orchestrator', script: 'tests/test_step7_orchestrator.js' },
  { name: 'Step 8: 端到端评测', script: 'tests/test_step8_e2e.js' }
];

function runScript(scriptPath) {
  try {
    const output = execSync(`node "${scriptPath}"`, {
      stdio: 'pipe',
      encoding: 'utf-8',
      cwd: __dirname
    });
    return { code: 0, output };
  } catch (e) {
    return { code: e.status || 1, output: (e.stdout || '') + (e.stderr || '') };
  }
}

function extractResult(output) {
  const match = output.match(/结果:\s*(\d+)\s*通过,\s*(\d+)\s*失败/);
  if (match) {
    const passed = parseInt(match[1]);
    const failed = parseInt(match[2]);
    return { passed, failed, total: passed + failed };
  }
  return null;
}

async function main() {
  console.log('🚀 Mavis Data Agent - 8 步全跑\n');
  const startTime = Date.now();
  const results = [];

  for (const step of STEPS) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`▶ ${step.name}`);
    console.log('═'.repeat(60));

    const { code, output } = runScript(path.join(__dirname, step.script));

    // 打印输出
    console.log(output);

    // 提取测试结果
    const extracted = extractResult(output);
    results.push({ name: step.name, code, ...extracted });

    if (code !== 0) {
      console.log(`\n❌ ${step.name} 失败 (exit ${code})`);
      break;
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const passed = results.filter(r => r.code === 0).length;
  const totalTests = results.reduce((s, r) => s + (r.passed || 0), 0);
  const totalFails = results.reduce((s, r) => s + (r.failed || 0), 0);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 总结果: ${passed}/${STEPS.length} 步通过, ${totalTests} 测试通过, ${totalFails} 失败, 耗时 ${totalTime}s`);
  console.log('═'.repeat(60));
  process.exit(passed === STEPS.length ? 0 : 1);
}

main();
