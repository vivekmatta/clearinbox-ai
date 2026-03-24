// Job application tracker — local pattern matching, zero API calls

const STATUS_PRIORITY = ['offered', 'interview', 'screening', 'applied', 'rejected'];

const STATUS_PATTERNS = {
  offered: [
    'offer letter', 'job offer', 'pleased to offer', 'welcome to the team',
    'congratulations on your offer', 'excited to extend', 'formal offer',
    'background check', 'start date', 'onboarding', 'sign your offer'
  ],
  interview: [
    'interview invitation', 'interview scheduled', 'would like to invite you',
    'advance to the next', 'move forward with your application',
    'schedule a call', 'schedule time with', 'speak with you',
    'next round', 'final round', 'panel interview', 'on-site interview',
    'virtual interview', 'phone screen', 'phone interview',
    'we\'d like to meet', 'we would like to meet', 'chat with our team',
    'connect with you', 'moving you forward'
  ],
  screening: [
    'coding challenge', 'take-home', 'technical screen', 'technical assessment',
    'online assessment', 'skills assessment', 'hackerrank', 'codesignal',
    'hirevue', 'video interview', 'codility', 'karat', 'pymetrics',
    'complete the following', 'complete this assessment'
  ],
  applied: [
    'application received', 'thank you for applying', 'we received your application',
    'application submitted', 'successfully applied', 'application confirmed',
    'your application for', 'your application was sent', 'your application has been',
    'you applied to', 'you\'ve applied', 'has been submitted', 'application has been received',
    'successfully submitted your application', 'applied for the position',
    'we got your application', 'application is under review'
  ],
  rejected: [
    'we regret to inform', 'unfortunately', 'not moving forward',
    'decided to move in a different direction', 'other candidates',
    'position has been filled', 'not selected', 'will not be moving',
    'will not be proceeding', 'decided not to move forward',
    'after careful consideration', 'not be the right fit',
    'we have decided', 'chosen to move forward with other', 'kept on file'
  ]
};

// Known job platform domains — treat any email from these as job-related
const JOB_DOMAINS = [
  'greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'workday.com',
  'myworkdayjobs.com', 'indeed.com', 'linkedin.com', 'glassdoor.com',
  'smartrecruiters.com', 'icims.com', 'taleo.net', 'successfactors.com',
  'jobvite.com', 'breezy.hr', 'ashbyhq.com', 'rippling.com',
  'bamboohr.com', 'recruiting.ultipro.com'
];

// Suffixes to strip from company names
const COMPANY_SUFFIXES = /\b(recruiting|talent|careers|hiring|hr|jobs|noreply|no-reply|team|notifications?|alerts?|do-not-reply)\b/gi;

function extractCompany(from) {
  // "Stripe Recruiting <jobs@stripe.com>" → "Stripe"
  const nameMatch = from.match(/^([^<]+)/);
  if (!nameMatch) return from;
  const cleaned = nameMatch[1].replace(COMPANY_SUFFIXES, '').replace(/[,.|]+$/, '').trim();
  if (cleaned) return cleaned;

  // Fall back to domain from email address
  const emailMatch = from.match(/@([^>.\s]+)/);
  if (emailMatch) return emailMatch[1].charAt(0).toUpperCase() + emailMatch[1].slice(1);

  return from;
}

function extractJobTitle(subject) {
  const patterns = [
    /(?:application for|applying for|role of|position of|applied for|application to)\s+(.+?)(?:\s+at\s+|\s+-\s+|,|$)/i,
    /(?:interview for|invitation for|offer for)\s+(.+?)(?:\s+at\s+|\s+-\s+|,|$)/i,
    /^(?:re:\s*|fw:\s*)?(.+?)\s+(?:at|@|-|–)\s+[\w\s]+$/i
  ];
  for (const re of patterns) {
    const m = subject.match(re);
    if (m && m[1] && m[1].length < 60) return m[1].trim();
  }
  return '';
}

function getSenderDomain(from) {
  const m = from.match(/@([\w.-]+)/);
  return m ? m[1].toLowerCase() : '';
}

function isJobDomain(from) {
  const domain = getSenderDomain(from);
  return JOB_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
}

function detectStatus(text, from) {
  const lower = text.toLowerCase();
  for (const status of STATUS_PRIORITY) {
    if (STATUS_PATTERNS[status].some(p => lower.includes(p))) {
      return status;
    }
  }
  // If it's a known job platform domain but no specific status matched, call it applied
  if (isJobDomain(from)) return 'applied';
  return null;
}

export function scanJobs(emails) {
  const byCompany = new Map(); // company (lowercase) → best entry

  for (const email of emails) {
    const searchText = `${email.subject || ''} ${email.snippet || ''}`;
    const status = detectStatus(searchText, email.from || '');
    if (!status) continue;

    const company = extractCompany(email.from || '');
    const companyKey = company.toLowerCase();
    const jobTitle = extractJobTitle(email.subject || '');

    const entry = {
      emailId: email.id,
      company,
      status,
      jobTitle,
      date: email.date || '',
      subject: email.subject || '',
      from: email.from || ''
    };

    // Keep highest-priority status per company
    const existing = byCompany.get(companyKey);
    if (!existing || STATUS_PRIORITY.indexOf(status) < STATUS_PRIORITY.indexOf(existing.status)) {
      byCompany.set(companyKey, entry);
    }
  }

  // Sort by status priority, then by date descending
  return Array.from(byCompany.values()).sort((a, b) => {
    const pDiff = STATUS_PRIORITY.indexOf(a.status) - STATUS_PRIORITY.indexOf(b.status);
    if (pDiff !== 0) return pDiff;
    return (b.date || '').localeCompare(a.date || '');
  });
}
