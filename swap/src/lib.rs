//! Swap desk for Ajo on NEAR (testnet).
//!
//! Circles save in NEAR, but members can pay with other NEAR tokens. A member
//! sends USDC, USDT or wNEAR here with `ft_transfer_call`; the desk converts it
//! to NEAR at a fixed test rate from its own NEAR reserve and pays the circle
//! for the member (`ajo.pay_for`) in the same transaction. If the circle refuses
//! the payment, the NEAR comes back to the desk and the tokens go back to the
//! member.
//!
//! On mainnet this conversion would go through NEAR Intents at market prices;
//! testnet has no reliable liquidity, so the rates here are fixed and public.

use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::serde_json::{self, json, Value};
use near_sdk::{
    env, near, require, AccountId, Gas, GasWeight, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};

const GAS_FOR_PAY_MIN: Gas = Gas::from_tgas(30);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(10);
/// NEAR the desk always keeps for its own storage and gas.
const KEEP: u128 = 500_000_000_000_000_000_000_000; // 0.5 NEAR

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Rate {
    pub token: AccountId,
    pub symbol: String,
    pub decimals: u8,
    /// yoctoNEAR given for one smallest unit of the token.
    pub yocto_per_unit: U128,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Order {
    /// Exact NEAR (yocto) to pay into the circle.
    near_amount: U128,
    /// The Ajo action, e.g. {"action":"contribute","circle_id":3}.
    action: Value,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Desk {
    owner: AccountId,
    ajo: AccountId,
    rates: Vec<Rate>,
}

#[near]
impl Desk {
    #[init]
    pub fn new(owner: AccountId, ajo: AccountId, rates: Vec<Rate>) -> Self {
        Self { owner, ajo, rates }
    }

    pub fn set_rate(&mut self, rate: Rate) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        self.rates.retain(|r| r.token != rate.token);
        self.rates.push(rate);
    }

    /// Anyone can top up the desk's NEAR reserve.
    #[payable]
    pub fn fund(&mut self) {}

    pub fn withdraw(&mut self, amount: U128) -> Promise {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(amount.0))
    }

    // ------------------------------------------------------------ views

    pub fn get_rates(&self) -> Vec<Rate> {
        self.rates.clone()
    }

    /// Token units needed to pay `near_amount` yoctoNEAR (rounded up).
    pub fn quote(&self, token: AccountId, near_amount: U128) -> U128 {
        let r = self.rate(&token);
        U128(near_amount.0.div_ceil(r))
    }

    /// NEAR the desk can still pay out.
    pub fn reserve(&self) -> U128 {
        U128(self.available())
    }

    // ------------------------------------------------------------ NEP-141 receiver

    /// `msg` = {"near_amount":"<yocto>","action":{"action":"contribute","circle_id":3}}
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let rate = self.rate(&token);
        let order: Order = serde_json::from_str(&msg)
            .unwrap_or_else(|_| env::panic_str("Invalid msg: expected {\"near_amount\":\"...\",\"action\":{...}}"));
        let near = order.near_amount.0;
        require!(near > 0, "near_amount must be positive");
        require!(amount.0.saturating_mul(rate) >= near, "Not enough tokens for that much NEAR at the test rate");
        require!(self.available() >= near, "The swap desk is out of test NEAR; try again later or pay with NEAR");
        Promise::new(self.ajo.clone())
            .function_call_weight(
                "pay_for",
                json!({ "member": sender_id, "action": order.action.to_string() }).to_string().into_bytes(),
                NearToken::from_yoctonear(near),
                GAS_FOR_PAY_MIN,
                GasWeight(1),
            )
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "on_paid",
                    json!({ "amount": amount }).to_string().into_bytes(),
                    NearToken::from_yoctonear(0),
                    GAS_FOR_CALLBACK,
                ),
            )
            .into()
    }

    /// Tokens used: all of them if the circle took the payment, none otherwise
    /// (the token contract then refunds the member).
    #[private]
    pub fn on_paid(&mut self, amount: U128) -> U128 {
        match env::promise_result_checked(0, 0) {
            Ok(_) => U128(0),
            Err(_) => amount,
        }
    }

    // ------------------------------------------------------------ internal

    fn rate(&self, token: &AccountId) -> u128 {
        self.rates
            .iter()
            .find(|r| &r.token == token)
            .map(|r| r.yocto_per_unit.0)
            .unwrap_or_else(|| env::panic_str("This token can't be swapped here"))
    }

    fn available(&self) -> u128 {
        let storage = env::storage_byte_cost().as_yoctonear() * env::storage_usage() as u128;
        env::account_balance().as_yoctonear().saturating_sub(storage).saturating_sub(KEEP)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const ONE: u128 = 1_000_000_000_000_000_000_000_000;
    fn acc(s: &str) -> AccountId { s.parse().unwrap() }
    fn ctx(who: &str, balance: u128) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(acc(who)).current_account_id(acc("swap.ajo.testnet"))
            .account_balance(NearToken::from_yoctonear(balance));
        testing_env!(b.build());
    }
    fn desk() -> Desk {
        ctx("owner.testnet", 10 * ONE);
        Desk::new(acc("owner.testnet"), acc("ajo.testnet"), vec![
            Rate { token: acc("usdc.testnet"), symbol: "USDC".into(), decimals: 6, yocto_per_unit: U128(ONE / 2_500_000) },
            Rate { token: acc("wrap.testnet"), symbol: "wNEAR".into(), decimals: 24, yocto_per_unit: U128(1) },
        ])
    }

    #[test]
    fn quote_rounds_up() {
        let d = desk();
        assert_eq!(d.quote(acc("usdc.testnet"), U128(ONE)).0, 2_500_000); // 1 NEAR = 2.5 USDC
        assert_eq!(d.quote(acc("wrap.testnet"), U128(ONE)).0, ONE);
        assert_eq!(d.quote(acc("usdc.testnet"), U128(ONE / 100)).0, 25_000);
    }

    #[test]
    fn pays_circle_for_member() {
        let mut d = desk();
        ctx("usdc.testnet", 10 * ONE);
        let r = d.ft_on_transfer(acc("ada.testnet"), U128(25_000),
            r#"{"near_amount":"10000000000000000000000","action":{"action":"contribute","circle_id":1}}"#.into());
        assert!(matches!(r, PromiseOrValue::Promise(_)));
    }

    #[test]
    #[should_panic(expected = "Not enough tokens")]
    fn too_few_tokens() {
        let mut d = desk();
        ctx("usdc.testnet", 10 * ONE);
        let _ = d.ft_on_transfer(acc("ada.testnet"), U128(24_999),
            r#"{"near_amount":"10000000000000000000000","action":{"action":"contribute","circle_id":1}}"#.into());
    }

    #[test]
    #[should_panic(expected = "can't be swapped")]
    fn unknown_token() {
        let mut d = desk();
        ctx("fake.testnet", 10 * ONE);
        let _ = d.ft_on_transfer(acc("ada.testnet"), U128(1), r#"{"near_amount":"1","action":{}}"#.into());
    }

    #[test]
    #[should_panic(expected = "out of test NEAR")]
    fn reserve_runs_out() {
        let mut d = desk();
        ctx("wrap.testnet", ONE / 2);
        let _ = d.ft_on_transfer(acc("ada.testnet"), U128(ONE),
            r#"{"near_amount":"1000000000000000000000000","action":{"action":"contribute","circle_id":1}}"#.into());
    }

    #[test]
    #[should_panic(expected = "Only the owner")]
    fn only_owner_sets_rates() {
        let mut d = desk();
        ctx("mallory.testnet", ONE);
        d.set_rate(Rate { token: acc("x.testnet"), symbol: "X".into(), decimals: 6, yocto_per_unit: U128(1) });
    }
}
