# Legacy: ENS integration (not used)

PayGate no longer depends on ENS. These files are kept for reference only and
are excluded from the build, typecheck and lint.

- `ens.ts`: forward/reverse ENS resolution used to check provider identity
- `subdomain.ts`, `contract.ts`, `resolver.ts`, `subdomain-check-route.ts`: `yourname.paygate.eth` subdomains on Sepolia
- `test-ens.ts`: manual script for the subdomain contract

Providers now identify by the wallet they connect on the Provider page (and
their Hedera account ID). The spending firewall's generic `identity_mismatch`
rule remains, ready for a future identity source such as Hedera HCS-14.
