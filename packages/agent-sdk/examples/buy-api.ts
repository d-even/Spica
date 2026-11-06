/**
 * Finds the cheapest API for a task, checks it fits the budget, and buys one call.
 * Set SPICA_API_KEY and SPICA_BASE_URL first. A purchase here is a real testnet payment.
 */
import { BudgetExceededError, PaymentUncertainError, SPICA } from '../src/index.js';

const spica = new SPICA();

const services = await spica.discover({ query: 'weather', maxPrice: '0.05' });
if (services.length === 0) throw new Error('No matching API is listed.');

const comparison = await spica.compare(await Promise.all(services.slice(0, 3).map((service) => spica.inspect(service.id))));
if (!comparison.cheapestId) throw new Error('None of these can be paid on this network.');

const serviceId = comparison.cheapestId;
const quote = await spica.quote({ serviceId });
const budget = await spica.getBudget();
console.log(`Quote: $${quote.price.usd}. Left today: $${budget.remainingToday.usd}.`);

// Tied to the job, so a restarted agent reuses it and cannot pay twice.
const idempotencyKey = `weather-pune-${new Date().toISOString().slice(0, 10)}`;

try {
  const result = await spica.purchase({ serviceId, idempotencyKey, params: { city: 'Pune' } });
  switch (result.status) {
    case 'settled':
      console.log('Paid and confirmed:', result.proofUrl, result.data);
      break;
    case 'settling':
      console.log('Accepted, not final yet. Run this again later to check:', result.data);
      break;
    case 'pending_approval':
      console.log(`Waiting for a person to approve $${result.price.usd}: ${result.reason}`);
      break;
    case 'free':
      console.log('No payment was needed:', result.data);
      break;
    case 'simulated':
      console.log('Demo server, so no money moved:', result.data);
      break;
  }
} catch (error) {
  if (error instanceof BudgetExceededError) console.log('Over budget, and nothing was paid.');
  else if (error instanceof PaymentUncertainError) console.log(`Unknown outcome. Run again with the same key: ${error.idempotencyKey}`);
  else throw error;
}
