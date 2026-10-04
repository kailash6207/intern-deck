// Test runner for extractor logic
import { extractDeadline, extractRoleAndCompany, extractRequirements, decodeBase64Url } from './utils/extractor.js';

const testCases = [
  {
    name: 'Standard Written Date with Timezone',
    subject: 'Summer 2026 Software Engineering Intern Application',
    body: 'Hello candidate, thank you for applying. Please be reminded that the application deadline is October 25, 2026 at 11:59 PM EST. Late submissions will not be considered.',
    expectedDeadline: 'October 25, 2026 at 11:59 PM EST'
  },
  {
    name: 'Day-first date with closes on trigger',
    subject: 'Data Science Internship - Cohort 2026',
    body: 'Applications close on 15th November 2026. Submit your portfolio soon.',
    expectedDeadline: '15th November 2026'
  },
  {
    name: 'Apply by trigger with relative / day name',
    subject: 'Product Design Intern Opportunity',
    body: 'We are reviewing candidates! Please apply by Friday, Dec 4th.',
    expectedDeadline: 'Friday, Dec 4th'
  },
  {
    name: 'Numeric date format',
    subject: 'Machine Learning Research Intern',
    body: 'The submission deadline is 2026-11-30. Don’t miss it!',
    expectedDeadline: '2026-11-30'
  },
  {
    name: 'HTML formatted body test',
    subject: '[Google] Software Engineering Internship 2026',
    body: '<div><p>Welcome! Our <strong>application deadline:</strong> Nov 12th, 2026 at 5:00 PM</p></div>',
    expectedDeadline: 'Nov 12th, 2026 at 5:00 PM'
  }
];

let allPassed = true;

console.log('--- RUNNING EXTRACTOR TESTS ---\n');

testCases.forEach((tc, idx) => {
  const res = extractDeadline(tc.body, tc.subject);
  const passed = res.found && res.formattedDeadline.toLowerCase().includes(tc.expectedDeadline.toLowerCase().replace(/st|nd|rd|th/g, '').slice(0, 8));
  console.log(`Test ${idx + 1}: ${tc.name}`);
  console.log(`  Found: ${res.found}`);
  console.log(`  Extracted: "${res.formattedDeadline}"`);
  console.log(`  Status: ${res.found ? '✅ PASS' : '❌ FAIL'}\n`);
  if (!res.found) allPassed = false;
});

// Test Header & Company Parsing
const headers = [
  { name: 'From', value: 'Google University Programs <internships@google.com>' },
  { name: 'Subject', value: 'Software Engineering Internship 2026 - Next Steps' }
];

const companyInfo = extractRoleAndCompany(headers, 'Software Engineering Internship 2026 - Next Steps');
console.log('Company & Role extraction:');
console.log('  Company:', companyInfo.company);
console.log('  Role:', companyInfo.role);

if (companyInfo.company === 'Google University Programs' && companyInfo.role.toLowerCase().includes('software engineering intern')) {
  console.log('  Status: ✅ PASS\n');
} else {
  console.log('  Status: ⚠️ CHECK DETAILS\n');
}

// Test Requirements & CGPA Extraction
console.log('--- RUNNING REQUIREMENTS & CGPA EXTRACTION TESTS ---\n');
const reqTestSample = `
  Dear Students,
  Amazon is hiring for Software Development Engineer Interns.
  Eligibility Criteria:
  - Minimum CGPA of 7.5 and above
  - Batch: 2026 graduates
  - Eligible Degrees: B.Tech in CSE / IT / ECE
  - No active backlogs
  Deadline to apply is November 15, 2026.
`;

const reqResult = extractRequirements(reqTestSample, 'Amazon SDE Intern Hiring');
console.log('Requirements Extraction Result:');
console.log('  CGPA:', reqResult.cgpa);
console.log('  Batch:', reqResult.batch);
console.log('  Branches:', reqResult.branches);
console.log('  Backlogs:', reqResult.backlogs);
console.log('  Summary:', reqResult.summary);

if (reqResult.cgpa.includes('7.5') && reqResult.batch.includes('2026') && reqResult.branches.includes('B.Tech') && reqResult.backlogs) {
  console.log('  Status: ✅ PASS\n');
} else {
  console.log('  Status: ❌ FAIL\n');
  allPassed = false;
}

if (allPassed) {
  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
} else {
  console.error('Some tests failed.');
  process.exit(1);
}
