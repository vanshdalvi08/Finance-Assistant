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

export interface Expense {
  id: string;
  category: string;
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
];

export const mockFunds: Fund[] = [
  { id: '1', source: 'Series A Funding', amount: 5000000, date: '2023-01-15T10:00:00Z', note: 'Lead by Sequoia' },
  { id: '2', source: 'Q3 Revenue', amount: 450000, date: '2023-10-05T10:00:00Z', note: 'Stripe payouts' },
];

export const mockExpenses: Expense[] = [
  { id: '1', category: 'Software', amount: 2500, date: '2023-10-02T10:00:00Z', description: 'AWS Hosting' },
  { id: '2', category: 'Office', amount: 15000, date: '2023-10-03T10:00:00Z', description: 'SF Office Rent' },
  { id: '3', category: 'Travel', amount: 1200, date: '2023-10-12T10:00:00Z', description: 'Team Offsite' },
];

export const mockTransactions: Transaction[] = [
  { id: 't1', type: 'fund', amount: 450000, date: '2023-10-05T10:00:00Z', description: 'Q3 Revenue', category: 'Revenue' },
  { id: 't2', type: 'expense', amount: -15000, date: '2023-10-03T10:00:00Z', description: 'SF Office Rent', category: 'Office' },
  { id: 't3', type: 'expense', amount: -2500, date: '2023-10-02T10:00:00Z', description: 'AWS Hosting', category: 'Software' },
  { id: 't4', type: 'salary', amount: -10000, date: '2023-10-01T10:00:00Z', description: 'Alice Smith Salary', category: 'Payroll' },
  { id: 't5', type: 'salary', amount: -11250, date: '2023-10-01T10:00:00Z', description: 'Bob Jones Salary', category: 'Payroll' },
  { id: 't6', type: 'expense', amount: -1200, date: '2023-10-12T10:00:00Z', description: 'Team Offsite', category: 'Travel' },
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
  { name: 'Office', value: 120000 },
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
};
