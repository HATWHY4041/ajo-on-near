//! Test stablecoin for Ajo on NEAR testnet. Deployed twice: tUSDC and tUSDT.
//!
//! A NEP-141 fungible token with three testnet-only extras:
//! - `faucet()`: anyone can mint 100 tokens for themselves once an hour.
//! - `buy_with_near()`: attach NEAR and receive tokens at a fixed test rate.
//! - Partner swap: sending the partner stablecoin here with `ft_transfer_call`
//!   mints the same amount of this token to the sender (1:1).
//! - Both conversions can forward the result straight on with
//!   `ft_transfer_call`, so "pay a tUSDC circle with NEAR or tUSDT" is one
//!   transaction for the member.
//!
//! Accounts never need a storage deposit; the contract covers storage. This keeps
//! the testnet experience to one click. None of this is meant for real money.

use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::LookupMap;
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, GasWeight, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};

const FAUCET_COOLDOWN_NS: u64 = 3_600_000_000_000; // one hour
const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_TRANSFER_MIN: Gas = Gas::from_tgas(5);
const ONE_NEAR: u128 = 1_000_000_000_000_000_000_000_000;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Balances,
    Faucet,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Metadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
    pub decimals: u8,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Forward {
    receiver_id: AccountId,
    #[serde(default)]
    msg: String,
}

#[derive(Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Token {
    owner: AccountId,
    balances: LookupMap<AccountId, u128>,
    supply: u128,
    meta: Metadata,
    /// Token units minted per 1 NEAR in `buy_with_near` (a fixed test rate).
    near_rate: u128,
    /// The other test stablecoin, swapped 1:1 into this one.
    partner: Option<AccountId>,
    last_faucet: LookupMap<AccountId, u64>,
}

fn event(kind: &str, data: String) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"nep141\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":[{}]}}",
        kind, data
    ));
}

#[near]
impl Token {
    #[init]
    pub fn new(owner: AccountId, name: String, symbol: String, decimals: u8, near_rate: U128, partner: Option<AccountId>) -> Self {
        Self {
            owner,
            balances: LookupMap::new(Key::Balances),
            supply: 0,
            meta: Metadata { spec: "ft-1.0.0".into(), name, symbol, icon: None, reference: None, reference_hash: None, decimals },
            near_rate: near_rate.0,
            partner,
            last_faucet: LookupMap::new(Key::Faucet),
        }
    }

    pub fn set_partner(&mut self, partner: AccountId) {
        require!(env::predecessor_account_id() == self.owner, "Only the owner");
        self.partner = Some(partner);
    }

    // ------------------------------------------------------------ testnet extras

    /// Mint 100 tokens to the caller, at most once an hour.
    pub fn faucet(&mut self) -> U128 {
        let who = env::predecessor_account_id();
        let now = env::block_timestamp();
        if let Some(last) = self.last_faucet.get(&who) {
            require!(now >= last + FAUCET_COOLDOWN_NS, "Faucet used in the last hour; try again later");
        }
        self.last_faucet.insert(who.clone(), now);
        let amount = 100 * 10u128.pow(self.meta.decimals as u32);
        self.mint(&who, amount, "faucet");
        U128(amount)
    }

    /// Attach NEAR and receive tokens at the fixed test rate. With
    /// `receiver_id`, `forward_amount` (default: everything bought) is then sent
    /// on with `ft_transfer_call` and `msg`.
    #[payable]
    pub fn buy_with_near(&mut self, receiver_id: Option<AccountId>, forward_amount: Option<U128>, msg: Option<String>) -> U128 {
        let near = env::attached_deposit().as_yoctonear();
        require!(near > 0, "Attach some NEAR");
        let amount = near * self.near_rate / ONE_NEAR;
        require!(amount > 0, "Too little NEAR for one token unit");
        let who = env::predecessor_account_id();
        self.mint(&who, amount, "bought with NEAR at test rate");
        if let Some(to) = receiver_id {
            let fwd = forward_amount.map(|a| a.0).unwrap_or(amount);
            require!(fwd <= amount, "Forward amount is more than was bought");
            self.move_tokens(&who, &to, fwd, None);
            self.transfer_call(who, to, fwd, msg.unwrap_or_default()).detach();
        }
        U128(amount)
    }

    /// NEAR needed (yoctoNEAR) to buy `amount` token units, rounded up.
    pub fn near_for(&self, amount: U128) -> U128 {
        U128((amount.0 * ONE_NEAR + self.near_rate - 1) / self.near_rate)
    }

    pub fn near_rate(&self) -> U128 {
        U128(self.near_rate)
    }

    pub fn partner(&self) -> Option<AccountId> {
        self.partner.clone()
    }

    // ------------------------------------------------------------ NEP-141

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "Requires attached deposit of exactly 1 yoctoNEAR");
        let sender = env::predecessor_account_id();
        self.move_tokens(&sender, &receiver_id, amount.0, memo);
    }

    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "Requires attached deposit of exactly 1 yoctoNEAR");
        let sender = env::predecessor_account_id();
        self.move_tokens(&sender, &receiver_id, amount.0, memo);
        self.transfer_call(sender, receiver_id, amount.0, msg).into()
    }

    fn transfer_call(&mut self, sender: AccountId, receiver_id: AccountId, amount: u128, msg: String) -> Promise {
        let amount = U128(amount);
        // The receiver gets a small fixed amount plus all gas left over.
        Promise::new(receiver_id.clone())
            .function_call_weight(
                "ft_on_transfer",
                near_sdk::serde_json::json!({ "sender_id": sender, "amount": amount, "msg": msg }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_ON_TRANSFER_MIN,
                GasWeight(1),
            )
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "ft_resolve_transfer",
                    near_sdk::serde_json::json!({ "sender_id": sender, "receiver_id": receiver_id, "amount": amount }).to_string().into_bytes(),
                    NearToken::from_yoctonear(0),
                    GAS_FOR_RESOLVE,
                ),
            )
    }

    /// Refunds whatever the receiver did not use. Returns the amount actually used.
    #[private]
    pub fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let unused = match env::promise_result_checked(0, 64) {
            Ok(v) => near_sdk::serde_json::from_slice::<U128>(&v).map(|u| u.0.min(amount.0)).unwrap_or(amount.0),
            Err(_) => amount.0,
        };
        if unused > 0 {
            let rb = self.balance(&receiver_id);
            let refund = unused.min(rb);
            if refund > 0 {
                self.balances.insert(receiver_id.clone(), rb - refund);
                let sb = self.balance(&sender_id);
                self.balances.insert(sender_id.clone(), sb + refund);
                event("ft_transfer", format!("{{\"old_owner_id\":\"{}\",\"new_owner_id\":\"{}\",\"amount\":\"{}\",\"memo\":\"refund\"}}", receiver_id, sender_id, refund));
                return U128(amount.0 - refund);
            }
        }
        amount
    }

    /// Receiving the partner stablecoin swaps it 1:1 into this token. If `msg`
    /// is `{"receiver_id": "...", "msg": "..."}`, the swapped tokens are sent on
    /// with `ft_transfer_call` in the same transaction.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let from = env::predecessor_account_id();
        require!(Some(from) == self.partner, "Only the partner stablecoin can be swapped here");
        self.mint(&sender_id, amount.0, "swapped 1:1 from partner stablecoin");
        if let Ok(fwd) = near_sdk::serde_json::from_str::<Forward>(&msg) {
            self.move_tokens(&sender_id, &fwd.receiver_id, amount.0, None);
            self.transfer_call(sender_id, fwd.receiver_id, amount.0, fwd.msg).detach();
        }
        PromiseOrValue::Value(U128(0))
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.supply)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balance(&account_id))
    }

    pub fn ft_metadata(&self) -> Metadata {
        self.meta.clone()
    }

    // NEP-145 compatibility: every account is treated as registered.
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        let _ = (account_id, registration_only);
        let d = env::attached_deposit();
        if d.as_yoctonear() > 0 {
            Promise::new(env::predecessor_account_id()).transfer(d).detach();
        }
        StorageBalance { total: U128(0), available: U128(0) }
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        let _ = account_id;
        Some(StorageBalance { total: U128(0), available: U128(0) })
    }

    pub fn storage_balance_bounds(&self) -> near_sdk::serde_json::Value {
        near_sdk::serde_json::json!({ "min": "0", "max": "0" })
    }

    // ------------------------------------------------------------ internal

    fn balance(&self, who: &AccountId) -> u128 {
        self.balances.get(who).copied().unwrap_or(0)
    }

    fn mint(&mut self, who: &AccountId, amount: u128, memo: &str) {
        let b = self.balance(who);
        self.balances.insert(who.clone(), b + amount);
        self.supply += amount;
        event("ft_mint", format!("{{\"owner_id\":\"{}\",\"amount\":\"{}\",\"memo\":\"{}\"}}", who, amount, memo));
    }

    fn move_tokens(&mut self, from: &AccountId, to: &AccountId, amount: u128, memo: Option<String>) {
        require!(amount > 0, "The amount should be a positive number");
        require!(from != to, "Sender and receiver should be different");
        let fb = self.balance(from);
        require!(fb >= amount, "The account doesn't have enough balance");
        self.balances.insert(from.clone(), fb - amount);
        let tb = self.balance(to);
        self.balances.insert(to.clone(), tb + amount);
        event("ft_transfer", format!("{{\"old_owner_id\":\"{}\",\"new_owner_id\":\"{}\",\"amount\":\"{}\"{}}}", from, to, amount,
            memo.map(|m| format!(",\"memo\":\"{}\"", m.replace('"', "'"))).unwrap_or_default()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn acc(s: &str) -> AccountId { s.parse().unwrap() }
    fn ctx(who: &str, dep: u128, ts: u64) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(acc(who)).current_account_id(acc("usdc.testnet")).attached_deposit(NearToken::from_yoctonear(dep)).block_timestamp(ts);
        testing_env!(b.build());
    }
    fn token() -> Token {
        ctx("owner.testnet", 0, 0);
        Token::new(acc("owner.testnet"), "Test USDC".into(), "tUSDC".into(), 6, U128(2_500_000), Some(acc("usdt.testnet")))
    }

    #[test]
    fn faucet_mints_100_once_an_hour() {
        let mut t = token();
        ctx("ada.testnet", 0, 1);
        assert_eq!(t.faucet().0, 100_000_000);
        assert_eq!(t.ft_balance_of(acc("ada.testnet")).0, 100_000_000);
        ctx("ada.testnet", 0, 1 + FAUCET_COOLDOWN_NS);
        t.faucet();
        assert_eq!(t.ft_balance_of(acc("ada.testnet")).0, 200_000_000);
        assert_eq!(t.ft_total_supply().0, 200_000_000);
    }

    #[test]
    #[should_panic(expected = "Faucet used in the last hour")]
    fn faucet_cooldown() {
        let mut t = token();
        ctx("ada.testnet", 0, 1);
        t.faucet();
        ctx("ada.testnet", 0, 2);
        t.faucet();
    }

    #[test]
    fn buy_with_near_uses_test_rate() {
        let mut t = token();
        ctx("ada.testnet", 4 * ONE_NEAR, 1);
        assert_eq!(t.buy_with_near(None, None, None).0, 10_000_000); // 4 NEAR -> 10 tUSDC at 2.5
        let need = t.near_for(U128(10_000_000)).0;
        assert_eq!(need, 4 * ONE_NEAR);
    }

    #[test]
    fn buy_and_forward_moves_tokens_to_receiver() {
        let mut t = token();
        ctx("ada.testnet", 4 * ONE_NEAR, 1);
        t.buy_with_near(Some(acc("ajo.testnet")), Some(U128(10_000_000)), Some("{}".into()));
        assert_eq!(t.ft_balance_of(acc("ajo.testnet")).0, 10_000_000);
        assert_eq!(t.ft_balance_of(acc("ada.testnet")).0, 0);
    }

    #[test]
    fn swap_and_forward_moves_tokens_to_receiver() {
        let mut t = token();
        ctx("usdt.testnet", 0, 1);
        let _ = t.ft_on_transfer(acc("ada.testnet"), U128(5_000_000), r#"{"receiver_id":"ajo.testnet","msg":"{}"}"#.into());
        assert_eq!(t.ft_balance_of(acc("ajo.testnet")).0, 5_000_000);
        assert_eq!(t.ft_balance_of(acc("ada.testnet")).0, 0);
    }

    #[test]
    fn transfer_moves_balance() {
        let mut t = token();
        ctx("ada.testnet", 0, 1);
        t.faucet();
        ctx("ada.testnet", 1, 2);
        t.ft_transfer(acc("bayo.testnet"), U128(30_000_000), None);
        assert_eq!(t.ft_balance_of(acc("ada.testnet")).0, 70_000_000);
        assert_eq!(t.ft_balance_of(acc("bayo.testnet")).0, 30_000_000);
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn transfer_needs_one_yocto() {
        let mut t = token();
        ctx("ada.testnet", 0, 1);
        t.faucet();
        t.ft_transfer(acc("bayo.testnet"), U128(1), None);
    }

    #[test]
    #[should_panic(expected = "enough balance")]
    fn cannot_overspend() {
        let mut t = token();
        ctx("ada.testnet", 1, 1);
        t.ft_transfer(acc("bayo.testnet"), U128(1), None);
    }

    #[test]
    fn partner_swap_mints_one_to_one() {
        let mut t = token();
        ctx("usdt.testnet", 0, 1);
        let _ = t.ft_on_transfer(acc("ada.testnet"), U128(25_000_000), "swap".into());
        assert_eq!(t.ft_balance_of(acc("ada.testnet")).0, 25_000_000);
    }

    #[test]
    #[should_panic(expected = "Only the partner stablecoin")]
    fn other_tokens_cannot_swap() {
        let mut t = token();
        ctx("random.testnet", 0, 1);
        let _ = t.ft_on_transfer(acc("ada.testnet"), U128(1), "".into());
    }
}
