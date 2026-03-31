export interface Employee {
  id: string;
  name: string;
  role: string;
  department: string;
  salary: number;
  status: 'Active' | 'Inactive';
}

export interface Salary {
  id: string;
  employeeId: string;
  amount: number;
  date: string;
  note: string;
}

export interface Fund {
  id: string;
  source: string;
  amount: number;
  date: string;
  note: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  color: string;
  group: 'personal' | 'office';
}

export interface Expense {
  id: string;
  category: string;
  group: 'personal' | 'office';
  amount: number;
  date: string;
  description: string;
}

export interface Transaction {
  id: string;
  type: 'fund' | 'salary' | 'expense';
  amount: number;
  date: string;
  description: string;
  category: string;
}

// Dummy Data
export const mockEmployees: Employee[] = [
  { id: '1', name: 'Alice Smith', role: 'Software Engineer', department: 'Engineering', salary: 120000, status: 'Active' },
  { id: '2', name: 'Bob Jones', role: 'Product Manager', department: 'Product', salary: 135000, status: 'Active' },
  { id: '3', name: 'Charlie Davis', role: 'Designer', department: 'Design', salary: 110000, status: 'Active' },
  { id: '4', name: 'Diana Evans', role: 'HR Manager', department: 'HR', salary: 95000, status: 'Active' },
  { id: '5', name: 'Evan Foster', role: 'Marketing Lead', department: 'Marketing', salary: 105000, status: 'Inactive' },
];

export const mockSalaries: Salary[] = [
  { id: '1', employeeId: '1', amount: 10000, date: '2023-10-01T10:00:00Z', note: 'October Salary' },
  { id: '2', employeeId: '2', amount: 11250, date: '2023-10-01T10:00:00Z', note: 'October Salary' },
  { id: '3', employeeId: '3', amount: 9167, date: '2023-10-01T10:00:00Z', note: 'October Salary' },
  { id: '4', employeeId: '1', amount: 10000, date: '2023-09-01T10:00:00Z', note: 'September Salary' },
  { id: '5', employeeId: '2', amount: 11250, date: '2023-09-01T10:00:00Z', note: 'September Salary' },
];

export const mockFunds: Fund[] = [
  { id: '1', source: 'Series A Funding', amount: 5000000, date: '2023-01-15T10:00:00Z', note: 'Lead by Sequoia' },
  { id: '2', source: 'Q3 Revenue', amount: 450000, date: '2023-10-05T10:00:00Z', note: 'Stripe payouts' },
  { id: '3', source: 'Angel Round', amount: 1000000, date: '2023-05-20T10:00:00Z', note: 'Individual investors' },
  { id: '4', source: 'Q2 Revenue', amount: 320000, date: '2023-07-05T10:00:00Z', note: 'Stripe payouts' },
];

export const mockCategories: ExpenseCategory[] = [
  // Office
  { id: 'oc1', name: 'Software', color: '#6366f1', group: 'office' },
  { id: 'oc2', name: 'Office Rent', color: '#f59e0b', group: 'office' },
  { id: 'oc3', name: 'Travel', color: '#10b981', group: 'office' },
  { id: 'oc4', name: 'Marketing', color: '#3b82f6', group: 'office' },
  { id: 'oc5', name: 'Legal', color: '#ef4444', group: 'office' },
  { id: 'oc6', name: 'Equipment', color: '#8b5cf6', group: 'office' },
  // Personal
  { id: 'pc1', name: 'Rent', color: '#f97316', group: 'personal' },
  { id: 'pc2', name: 'Groceries', color: '#22c55e', group: 'personal' },
  { id: 'pc3', name: 'Subscriptions', color: '#a855f7', group: 'personal' },
  { id: 'pc4', name: 'Health', color: '#ec4899', group: 'personal' },
  { id: 'pc5', name: 'Transport', color: '#14b8a6', group: 'personal' },
  { id: 'pc6', name: 'Entertainment', color: '#f59e0b', group: 'personal' },
];

export const mockExpenses: Expense[] = [
  { id: 'e1', category: 'Software', group: 'office', amount: 25000, date: '2023-10-02T10:00:00Z', description: 'AWS Hosting' },
  { id: 'e2', category: 'Office Rent', group: 'office', amount: 150000, date: '2023-10-03T10:00:00Z', description: 'Office Space Rent' },
  { id: 'e3', category: 'Travel', group: 'office', amount: 12000, date: '2023-10-12T10:00:00Z', description: 'Team Offsite' },
  { id: 'e4', category: 'Marketing', group: 'office', amount: 80000, date: '2023-10-15T10:00:00Z', description: 'Google Ads Campaign' },
  { id: 'e5', category: 'Legal', group: 'office', amount: 45000, date: '2023-10-18T10:00:00Z', description: 'Contract Review' },
  { id: 'e6', category: 'Equipment', group: 'office', amount: 60000, date: '2023-10-20T10:00:00Z', description: 'MacBook Pro x2' },
  { id: 'e7', category: 'Rent', group: 'personal', amount: 35000, date: '2023-10-01T10:00:00Z', description: 'Monthly Rent' },
  { id: 'e8', category: 'Groceries', group: 'personal', amount: 8500, date: '2023-10-07T10:00:00Z', description: 'Weekly Groceries' },
  { id: 'e9', category: 'Subscriptions', group: 'personal', amount: 2999, date: '2023-10-10T10:00:00Z', description: 'Netflix + Spotify' },
  { id: 'e10', category: 'Health', group: 'personal', amount: 4500, date: '2023-10-14T10:00:00Z', description: 'Gym Membership' },
  { id: 'e11', category: 'Transport', group: 'personal', amount: 3200, date: '2023-10-16T10:00:00Z', description: 'Fuel & Uber' },
  { id: 'e12', category: 'Entertainment', group: 'personal', amount: 5000, date: '2023-10-22T10:00:00Z', description: 'Dining & Movies' },
];

export const mockTransactions: Transaction[] = [
  { id: 't1', type: 'fund', amount: 450000, date: '2023-10-05T10:00:00Z', description: 'Q3 Revenue', category: 'Revenue' },
  { id: 't2', type: 'expense', amount: -150000, date: '2023-10-03T10:00:00Z', description: 'Office Space Rent', category: 'Office Rent' },
  { id: 't3', type: 'expense', amount: -25000, date: '2023-10-02T10:00:00Z', description: 'AWS Hosting', category: 'Software' },
  { id: 't4', type: 'salary', amount: -10000, date: '2023-10-01T10:00:00Z', description: 'Alice Smith Salary', category: 'Payroll' },
  { id: 't5', type: 'salary', amount: -11250, date: '2023-10-01T10:00:00Z', description: 'Bob Jones Salary', category: 'Payroll' },
  { id: 't6', type: 'expense', amount: -12000, date: '2023-10-12T10:00:00Z', description: 'Team Offsite', category: 'Travel' },
  { id: 't7', type: 'expense', amount: -80000, date: '2023-10-15T10:00:00Z', description: 'Google Ads Campaign', category: 'Marketing' },
  { id: 't8', type: 'salary', amount: -9167, date: '2023-10-01T10:00:00Z', description: 'Charlie Davis Salary', category: 'Payroll' },
  { id: 't9', type: 'expense', amount: -45000, date: '2023-10-18T10:00:00Z', description: 'Contract Review', category: 'Legal' },
  { id: 't10', type: 'fund', amount: 320000, date: '2023-07-05T10:00:00Z', description: 'Q2 Revenue', category: 'Revenue' },
  { id: 't11', type: 'expense', amount: -60000, date: '2023-10-20T10:00:00Z', description: 'MacBook Pro x2', category: 'Equipment' },
  { id: 't12', type: 'expense', amount: -35000, date: '2023-10-01T10:00:00Z', description: 'Monthly Rent', category: 'Rent' },
  { id: 't13', type: 'expense', amount: -8500, date: '2023-10-07T10:00:00Z', description: 'Weekly Groceries', category: 'Groceries' },
  { id: 't14', type: 'fund', amount: 1000000, date: '2023-05-20T10:00:00Z', description: 'Angel Round', category: 'Investment' },
];

export const mockChartData = [
  { month: 'May', funds: 400000, expenses: 240000, salary: 150000 },
  { month: 'Jun', funds: 420000, expenses: 250000, salary: 150000 },
  { month: 'Jul', funds: 450000, expenses: 270000, salary: 160000 },
  { month: 'Aug', funds: 480000, expenses: 260000, salary: 160000 },
  { month: 'Sep', funds: 510000, expenses: 280000, salary: 170000 },
  { month: 'Oct', funds: 550000, expenses: 290000, salary: 170000 },
];

export const mockExpenseCategories = [
  { name: 'Software', value: 45000 },
  { name: 'Office Rent', value: 120000 },
  { name: 'Travel', value: 25000 },
  { name: 'Marketing', value: 60000 },
  { name: 'Legal', value: 15000 },
];

export const api = {
  getEmployees: async () => mockEmployees,
  getSalaries: async () => mockSalaries,
  getFunds: async () => mockFunds,
  getExpenses: async () => mockExpenses,
  getTransactions: async () => mockTransactions,
  getChartData: async () => mockChartData,
  getExpenseCategories: async () => mockExpenseCategories,
  getCategories: async () => mockCategories,
};
