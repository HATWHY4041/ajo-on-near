//! Ajo on NEAR: rotating savings circles (ajo / esusu / susu) with a smart
//! contract as the collector.
//!
//! How a circle works:
//! 1. A creator opens a circle: a contribution amount, a round length and a
//!    member count. The creator joins at once by locking a security deposit
//!    equal to one contribution.
//! 2. Others join by locking the same deposit. When the circle is full, the
//!    payout order is shuffled with the block's random seed and round 1 starts.
//! 3. Every round each member pays one contribution. When everyone has paid,
//!    the whole pot goes to that round's recipient immediately.
//! 4. If the round deadline passes and someone has not paid, anyone can call
//!    `settle_round`: the missing contribution is taken from that member's
//!    deposit, the miss is recorded, and the pot is paid out anyway.
//! 5. After the last round, every member gets back what is left of their
//!    deposit, and each member's trust record (on-time and missed payments,
//!    circles completed) is updated. Circles can require a minimum trust score.

use near_sdk::json_types::U128;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise,
};

pub const MIN_MEMBERS: u32 = 2;
pub const MAX_MEMBERS: u32 = 20;
pub const MAX_PERIOD_MINUTES: u32 = 60 * 24 * 31;
pub const MAX_NAME_LEN: usize = 64;
const NS_PER_MS: u64 = 1_000_000;
const MS_PER_MINUTE: u64 = 60_000;

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Circles,
    Trust,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum CircleStatus {
    /// Waiting for members to join.
    Open,
    /// Full; rounds are running.
    Active,
    /// Every member has received the pot once.
    Completed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Member {
    pub account_id: AccountId,
    /// What is left of this member's security deposit, in yoctoNEAR.
    pub deposit_left: U128,
    pub paid_this_round: bool,
    pub on_time_payments: u32,
    pub missed_payments: u32,
    pub received_payout: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct RoundRecord {
    /// 1-based round number.
    pub round: u32,
    pub recipient: AccountId,
    pub amount: U128,
    /// Members whose contribution was covered from their deposit.
    pub missed_by: Vec<AccountId>,
    pub paid_at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Circle {
    pub id: u32,
    pub name: String,
    pub creator: AccountId,
    /// Amount each member pays per round, in yoctoNEAR.
    pub contribution: U128,
    /// Security deposit each member locks on joining (equal to one contribution).
    pub deposit: U128,
    pub max_members: u32,
    pub period_minutes: u32,
    /// Minimum trust score (0-100) needed to join. 0 = anyone.
    pub min_trust_score: u32,
    /// Join order while Open; payout order once Active.
    pub members: Vec<Member>,
    pub status: CircleStatus,
    /// 0-based index of the current round (= index of this round's recipient).
    pub current_round: u32,
    pub round_deadline_ms: u64,
    /// Collected so far this round, in yoctoNEAR.
    pub pot: U128,
    pub history: Vec<RoundRecord>,
    pub created_at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct TrustRecord {
    pub circles_completed: u32,
    pub on_time_payments: u32,
    pub missed_payments: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct TrustView {
    pub account_id: AccountId,
    pub circles_completed: u32,
    pub on_time_payments: u32,
    pub missed_payments: u32,
    /// Share of payments made on time, 0-100. 0 for accounts with no history.
    pub score: u32,
}

impl TrustRecord {
    fn score(&self) -> u32 {
        let total = self.on_time_payments as u64 + self.missed_payments as u64;
        if total == 0 {
            0
        } else {
            (self.on_time_payments as u64 * 100 / total) as u32
        }
    }
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    circles: Vector<Circle>,
    trust: LookupMap<AccountId, TrustRecord>,
}

fn block_ms() -> u64 {
    env::block_timestamp() / NS_PER_MS
}

fn emit(event: &str, data: String) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"ajo\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":[{}]}}",
        event, data
    ));
}

fn transfer(to: &AccountId, yocto: u128) {
    if yocto > 0 {
        Promise::new(to.clone())
            .transfer(NearToken::from_yoctonear(yocto))
            .detach();
    }
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self {
            circles: Vector::new(StorageKey::Circles),
            trust: LookupMap::new(StorageKey::Trust),
        }
    }

    // ---------------------------------------------------------------- calls

    /// Open a new circle. Attach exactly one `contribution` as your deposit;
    /// you become the first member. Returns the circle id.
    #[payable]
    pub fn create_circle(
        &mut self,
        name: String,
        contribution: U128,
        max_members: u32,
        period_minutes: u32,
        min_trust_score: Option<u32>,
    ) -> u32 {
        let name = name.trim().to_string();
        require!(!name.is_empty(), "Name is required");
        require!(name.len() <= MAX_NAME_LEN, "Name is too long (max 64 bytes)");
        require!(contribution.0 > 0, "Contribution must be greater than 0");
        require!(
            (MIN_MEMBERS..=MAX_MEMBERS).contains(&max_members),
            "Members must be between 2 and 20"
        );
        require!(
            (1..=MAX_PERIOD_MINUTES).contains(&period_minutes),
            "Round length must be between 1 minute and 31 days"
        );
        let min_trust_score = min_trust_score.unwrap_or(0);
        require!(min_trust_score <= 100, "Minimum trust score must be 0-100");
        require!(
            env::attached_deposit().as_yoctonear() == contribution.0,
            "Attach exactly one contribution as your security deposit"
        );

        let creator = env::predecessor_account_id();
        let id = self.circles.len();
        let circle = Circle {
            id,
            name,
            creator: creator.clone(),
            contribution,
            deposit: contribution,
            max_members,
            period_minutes,
            min_trust_score,
            members: vec![Self::new_member(&creator, contribution.0)],
            status: CircleStatus::Open,
            current_round: 0,
            round_deadline_ms: 0,
            pot: U128(0),
            history: vec![],
            created_at_ms: block_ms(),
        };
        self.circles.push(circle);
        emit(
            "circle_created",
            format!(
                "{{\"circle_id\":{},\"creator\":\"{}\",\"contribution\":\"{}\",\"max_members\":{}}}",
                id, creator, contribution.0, max_members
            ),
        );
        id
    }

    /// Join an open circle. Attach exactly the circle's `deposit`.
    /// The circle starts automatically when the last seat is taken.
    #[payable]
    pub fn join_circle(&mut self, circle_id: u32) {
        let mut c = self.load(circle_id);
        let who = env::predecessor_account_id();
        require!(c.status == CircleStatus::Open, "Circle is not open for joining");
        require!(Self::index_of(&c, &who).is_none(), "Already a member");
        require!(
            (c.members.len() as u32) < c.max_members,
            "Circle is full"
        );
        require!(
            env::attached_deposit().as_yoctonear() == c.deposit.0,
            "Attach exactly the circle's security deposit"
        );
        if c.min_trust_score > 0 {
            let score = self.trust.get(&who).cloned().unwrap_or_default().score();
            require!(
                score >= c.min_trust_score,
                format!(
                    "Trust score {} is below this circle's minimum of {}",
                    score, c.min_trust_score
                )
            );
        }
        c.members.push(Self::new_member(&who, c.deposit.0));
        emit(
            "member_joined",
            format!("{{\"circle_id\":{},\"account_id\":\"{}\"}}", circle_id, who),
        );
        if c.members.len() as u32 == c.max_members {
            Self::start(&mut c);
        }
        self.save(c);
    }

    /// Leave a circle that has not started yet. Your deposit is refunded.
    pub fn leave_circle(&mut self, circle_id: u32) {
        let mut c = self.load(circle_id);
        let who = env::predecessor_account_id();
        require!(
            c.status == CircleStatus::Open,
            "You can only leave before the circle starts"
        );
        let i = Self::index_of(&c, &who).unwrap_or_else(|| env::panic_str("Not a member"));
        let m = c.members.remove(i);
        transfer(&who, m.deposit_left.0);
        emit(
            "member_left",
            format!("{{\"circle_id\":{},\"account_id\":\"{}\"}}", circle_id, who),
        );
        self.save(c);
    }

    /// Pay this round's contribution. Attach exactly the circle's `contribution`.
    /// If you are the last to pay, the pot goes to this round's recipient now.
    #[payable]
    pub fn contribute(&mut self, circle_id: u32) {
        let mut c = self.load(circle_id);
        let who = env::predecessor_account_id();
        require!(c.status == CircleStatus::Active, "Circle is not active");
        let i = Self::index_of(&c, &who).unwrap_or_else(|| env::panic_str("Not a member"));
        require!(!c.members[i].paid_this_round, "Already paid this round");
        require!(
            block_ms() <= c.round_deadline_ms,
            "This round's deadline has passed; call settle_round first"
        );
        require!(
            env::attached_deposit().as_yoctonear() == c.contribution.0,
            "Attach exactly one contribution"
        );
        c.members[i].paid_this_round = true;
        c.members[i].on_time_payments += 1;
        c.pot = U128(c.pot.0 + c.contribution.0);
        emit(
            "contribution",
            format!(
                "{{\"circle_id\":{},\"round\":{},\"account_id\":\"{}\",\"amount\":\"{}\"}}",
                circle_id,
                c.current_round + 1,
                who,
                c.contribution.0
            ),
        );
        if c.members.iter().all(|m| m.paid_this_round) {
            self.close_round(&mut c, vec![]);
        }
        self.save(c);
    }

    /// After a round's deadline, anyone can settle it: unpaid contributions are
    /// covered from those members' deposits and the pot is paid out.
    pub fn settle_round(&mut self, circle_id: u32) {
        let mut c = self.load(circle_id);
        require!(c.status == CircleStatus::Active, "Circle is not active");
        require!(
            block_ms() > c.round_deadline_ms,
            "The round deadline has not passed yet"
        );
        let contribution = c.contribution.0;
        let mut missed_by = vec![];
        let mut pot = c.pot.0;
        for m in c.members.iter_mut().filter(|m| !m.paid_this_round) {
            let take = m.deposit_left.0.min(contribution);
            m.deposit_left = U128(m.deposit_left.0 - take);
            m.missed_payments += 1;
            pot += take;
            missed_by.push(m.account_id.clone());
        }
        c.pot = U128(pot);
        for who in &missed_by {
            emit(
                "missed_payment",
                format!(
                    "{{\"circle_id\":{},\"round\":{},\"account_id\":\"{}\"}}",
                    circle_id,
                    c.current_round + 1,
                    who
                ),
            );
        }
        self.close_round(&mut c, missed_by);
        self.save(c);
    }

    // ---------------------------------------------------------------- views

    pub fn get_circle(&self, circle_id: u32) -> Option<Circle> {
        self.circles.get(circle_id).cloned()
    }

    pub fn get_circles(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Circle> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(50).min(100);
        (from..self.circles.len())
            .take(limit as usize)
            .filter_map(|i| self.circles.get(i).cloned())
            .collect()
    }

    pub fn get_circles_for(&self, account_id: AccountId) -> Vec<Circle> {
        self.circles
            .iter()
            .filter(|c| c.members.iter().any(|m| m.account_id == account_id))
            .cloned()
            .collect()
    }

    pub fn get_circle_count(&self) -> u32 {
        self.circles.len()
    }

    pub fn get_trust(&self, account_id: AccountId) -> TrustView {
        let t = self.trust.get(&account_id).cloned().unwrap_or_default();
        TrustView {
            score: t.score(),
            account_id,
            circles_completed: t.circles_completed,
            on_time_payments: t.on_time_payments,
            missed_payments: t.missed_payments,
        }
    }

    /// Current block time in ms, so clients can show countdowns.
    pub fn now_ms(&self) -> u64 {
        block_ms()
    }

    // ------------------------------------------------------------- internal

    fn new_member(account_id: &AccountId, deposit: u128) -> Member {
        Member {
            account_id: account_id.clone(),
            deposit_left: U128(deposit),
            paid_this_round: false,
            on_time_payments: 0,
            missed_payments: 0,
            received_payout: false,
        }
    }

    fn load(&self, circle_id: u32) -> Circle {
        self.circles
            .get(circle_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Circle not found"))
    }

    fn save(&mut self, c: Circle) {
        let id = c.id;
        self.circles.replace(id, c);
    }

    fn index_of(c: &Circle, who: &AccountId) -> Option<usize> {
        c.members.iter().position(|m| &m.account_id == who)
    }

    /// Shuffle the payout order with the block's random seed and open round 1.
    fn start(c: &mut Circle) {
        let seed = env::random_seed();
        let n = c.members.len();
        for i in (1..n).rev() {
            let r = u16::from_le_bytes([seed[(2 * i) % 32], seed[(2 * i + 1) % 32]]) as usize;
            c.members.swap(i, r % (i + 1));
        }
        c.status = CircleStatus::Active;
        c.current_round = 0;
        c.round_deadline_ms = block_ms() + c.period_minutes as u64 * MS_PER_MINUTE;
        let order: Vec<String> = c
            .members
            .iter()
            .map(|m| format!("\"{}\"", m.account_id))
            .collect();
        emit(
            "circle_started",
            format!(
                "{{\"circle_id\":{},\"payout_order\":[{}]}}",
                c.id,
                order.join(",")
            ),
        );
    }

    /// Pay the pot to this round's recipient, then open the next round or
    /// finish the circle.
    fn close_round(&mut self, c: &mut Circle, missed_by: Vec<AccountId>) {
        let r = c.current_round as usize;
        let recipient = c.members[r].account_id.clone();
        let amount = c.pot.0;
        transfer(&recipient, amount);
        c.members[r].received_payout = true;
        c.history.push(RoundRecord {
            round: c.current_round + 1,
            recipient: recipient.clone(),
            amount: U128(amount),
            missed_by,
            paid_at_ms: block_ms(),
        });
        emit(
            "payout",
            format!(
                "{{\"circle_id\":{},\"round\":{},\"recipient\":\"{}\",\"amount\":\"{}\"}}",
                c.id,
                c.current_round + 1,
                recipient,
                amount
            ),
        );
        c.pot = U128(0);
        for m in c.members.iter_mut() {
            m.paid_this_round = false;
        }
        c.current_round += 1;

        if c.current_round as usize >= c.members.len() {
            c.status = CircleStatus::Completed;
            c.round_deadline_ms = 0;
            for m in &c.members {
                transfer(&m.account_id, m.deposit_left.0);
                let mut t = self.trust.get(&m.account_id).cloned().unwrap_or_default();
                t.circles_completed += 1;
                t.on_time_payments += m.on_time_payments;
                t.missed_payments += m.missed_payments;
                self.trust.insert(m.account_id.clone(), t);
            }
            emit("circle_completed", format!("{{\"circle_id\":{}}}", c.id));
        } else {
            c.round_deadline_ms = block_ms() + c.period_minutes as u64 * MS_PER_MINUTE;
        }
    }
}

#[cfg(test)]
mod tests;
