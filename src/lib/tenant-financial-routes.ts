export interface FinancialRouteAnswers {
  monthlyIncome: number | null;
  minimumIncome: number;
  hasGuarantor: boolean | null;
  hasDepositInsurance: boolean | null;
  savings: number | null;
  minimumSavings: number;
}

export interface FinancialRouteResult {
  pass: boolean | null;
  satisfiedRoutes: string[];
}

/** One route is enough. Unknown answers stay pending until every route is answered. */
export function evaluateFinancialRoutes(answers: FinancialRouteAnswers): FinancialRouteResult {
  const satisfiedRoutes = [
    answers.monthlyIncome !== null && answers.monthlyIncome >= answers.minimumIncome ? "income" : null,
    answers.hasGuarantor === true ? "guarantor" : null,
    answers.hasDepositInsurance === true ? "deposit insurance" : null,
    answers.savings !== null && answers.savings >= answers.minimumSavings ? "savings" : null,
  ].filter((route): route is string => route !== null);
  const allAnswered = answers.monthlyIncome !== null && answers.hasGuarantor !== null && answers.hasDepositInsurance !== null && answers.savings !== null;
  return { pass: satisfiedRoutes.length ? true : allAnswered ? false : null, satisfiedRoutes };
}
