use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;

const ONE: u128 = 1_000_000_000_000_000_000_000_000; // 1 NEAR
const MIN: u64 = 60_000 * 1_000_000; // 1 minute in ns

fn acc(name: &str) -> AccountId {
    format!("{}.testnet", name).parse().unwrap()
}

fn ctx(who: &str, attached: u128, time_ns: u64) {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(acc(who))
        .attached_deposit(NearToken::from_yoctonear(attached))
        .block_timestamp(time_ns);
    testing_env!(b.build());
}

/// A 3-member circle, 1 NEAR per round, 10-minute rounds, full and started.
fn full_circle() -> (Contract, u32) {
    ctx("ada", 0, 0);
    let mut c = Contract::new();
    ctx("ada", ONE, 0);
    let id = c.create_circle("Lagos Savers".into(), U128(ONE), 3, 10, None);
    ctx("bayo", ONE, 1);
    c.join_circle(id);
    ctx("chika", ONE, 2);
    c.join_circle(id);
    (c, id)
}

fn order(c: &Contract, id: u32) -> Vec<String> {
    c.get_circle(id)
        .unwrap()
        .members
        .iter()
        .map(|m| m.account_id.to_string().replace(".testnet", ""))
        .collect()
}

#[test]
fn create_makes_creator_first_member() {
    ctx("ada", 0, 0);
    let mut c = Contract::new();
    ctx("ada", ONE, 0);
    let id = c.create_circle("  Market Women  ".into(), U128(ONE), 5, 60, Some(0));
    let circle = c.get_circle(id).unwrap();
    assert_eq!(circle.name, "Market Women");
    assert_eq!(circle.status, CircleStatus::Open);
    assert_eq!(circle.members.len(), 1);
    assert_eq!(circle.members[0].deposit_left.0, ONE);
    assert_eq!(c.get_circle_count(), 1);
}

#[test]
#[should_panic(expected = "Attach exactly one contribution as your security deposit")]
fn create_requires_exact_deposit() {
    ctx("ada", 0, 0);
    let mut c = Contract::new();
    ctx("ada", ONE / 2, 0);
    c.create_circle("x".into(), U128(ONE), 3, 10, None);
}

#[test]
#[should_panic(expected = "Members must be between 2 and 20")]
fn create_rejects_bad_size() {
    ctx("ada", 0, 0);
    let mut c = Contract::new();
    ctx("ada", ONE, 0);
    c.create_circle("x".into(), U128(ONE), 1, 10, None);
}

#[test]
fn circle_starts_when_full() {
    let (c, id) = full_circle();
    let circle = c.get_circle(id).unwrap();
    assert_eq!(circle.status, CircleStatus::Active);
    assert_eq!(circle.current_round, 0);
    assert_eq!(circle.round_deadline_ms, 10 * 60_000);
    let mut o = order(&c, id);
    o.sort();
    assert_eq!(o, vec!["ada", "bayo", "chika"]);
}

#[test]
#[should_panic(expected = "Already a member")]
fn cannot_join_twice() {
    ctx("ada", 0, 0);
    let mut c = Contract::new();
    ctx("ada", ONE, 0);
    let id = c.create_circle("x".into(), U128(ONE), 3, 10, None);
    c.join_circle(id);
}

#[test]
#[should_panic(expected = "Circle is not open for joining")]
fn cannot_join_full_circle() {
    let (mut c, id) = full_circle();
    ctx("dayo", ONE, 3);
    c.join_circle(id);
}

#[test]
fn leave_before_start() {
    ctx("ada", 0, 0);
    let mut c = Contract::new();
    ctx("ada", ONE, 0);
    let id = c.create_circle("x".into(), U128(ONE), 3, 10, None);
    ctx("bayo", ONE, 1);
    c.join_circle(id);
    ctx("bayo", 0, 2);
    c.leave_circle(id);
    assert_eq!(c.get_circle(id).unwrap().members.len(), 1);
}

#[test]
fn full_circle_everyone_pays() {
    let (mut c, id) = full_circle();
    let o = order(&c, id);
    for round in 0..3u64 {
        for who in &o {
            ctx(who, ONE, 3 + round * MIN);
            c.contribute(id);
        }
        let circle = c.get_circle(id).unwrap();
        let rec = &circle.history[round as usize];
        assert_eq!(rec.round as u64, round + 1);
        assert_eq!(rec.recipient.to_string(), format!("{}.testnet", o[round as usize]));
        assert_eq!(rec.amount.0, 3 * ONE);
        assert!(rec.missed_by.is_empty());
    }
    let circle = c.get_circle(id).unwrap();
    assert_eq!(circle.status, CircleStatus::Completed);
    assert!(circle.members.iter().all(|m| m.received_payout));
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"circle_completed\"")));
    for who in ["ada", "bayo", "chika"] {
        let t = c.get_trust(acc(who));
        assert_eq!(t.circles_completed, 1);
        assert_eq!(t.on_time_payments, 3);
        assert_eq!(t.missed_payments, 0);
        assert_eq!(t.score, 100);
    }
}

#[test]
#[should_panic(expected = "Already paid this round")]
fn cannot_pay_twice_in_a_round() {
    let (mut c, id) = full_circle();
    ctx("ada", ONE, 3);
    c.contribute(id);
    c.contribute(id);
}

#[test]
#[should_panic(expected = "Attach exactly one contribution")]
fn contribution_amount_must_match() {
    let (mut c, id) = full_circle();
    ctx("ada", ONE * 2, 3);
    c.contribute(id);
}

#[test]
#[should_panic(expected = "Not a member")]
fn outsiders_cannot_contribute() {
    let (mut c, id) = full_circle();
    ctx("eve", ONE, 3);
    c.contribute(id);
}

#[test]
#[should_panic(expected = "The round deadline has not passed yet")]
fn cannot_settle_early() {
    let (mut c, id) = full_circle();
    ctx("eve", 0, 3);
    c.settle_round(id);
}

#[test]
#[should_panic(expected = "deadline has passed")]
fn cannot_pay_after_deadline() {
    let (mut c, id) = full_circle();
    ctx("ada", ONE, 11 * MIN);
    c.contribute(id);
}

#[test]
fn missed_payment_is_covered_by_deposit() {
    let (mut c, id) = full_circle();
    let o = order(&c, id);
    // Round 1: the last member in the order does not pay.
    ctx(&o[0], ONE, 3);
    c.contribute(id);
    ctx(&o[1], ONE, 4);
    c.contribute(id);
    // Anyone can settle after the deadline.
    ctx("passerby", 0, 11 * MIN);
    c.settle_round(id);

    let circle = c.get_circle(id).unwrap();
    let rec = &circle.history[0];
    assert_eq!(rec.amount.0, 3 * ONE, "recipient still gets a full pot");
    assert_eq!(rec.missed_by.len(), 1);
    let defaulter = circle.members.iter().find(|m| m.account_id == acc(&o[2])).unwrap();
    assert_eq!(defaulter.deposit_left.0, 0);
    assert_eq!(defaulter.missed_payments, 1);
    assert_eq!(circle.current_round, 1);
    assert_eq!(circle.round_deadline_ms, 21 * 60_000);
}

#[test]
fn defaulter_loses_trust_and_deposit_refunds_are_correct() {
    let (mut c, id) = full_circle();
    let o = order(&c, id);
    let mut t = 3u64;
    // Round 1: o[2] misses. Rounds 2 and 3: o[2] misses again (deposit already gone).
    for round in 0..3u64 {
        ctx(&o[0], ONE, t);
        c.contribute(id);
        ctx(&o[1], ONE, t + 1);
        c.contribute(id);
        t = (round + 1) * 11 * MIN;
        ctx("passerby", 0, t);
        c.settle_round(id);
        t += 1;
    }
    let circle = c.get_circle(id).unwrap();
    assert_eq!(circle.status, CircleStatus::Completed);
    assert_eq!(circle.history[0].amount.0, 3 * ONE);
    assert_eq!(circle.history[1].amount.0, 2 * ONE, "no deposit left to cover");
    assert_eq!(circle.history[2].amount.0, 2 * ONE);

    let good = c.get_trust(acc(&o[0]));
    assert_eq!(good.score, 100);
    let bad = c.get_trust(acc(&o[2]));
    assert_eq!(bad.missed_payments, 3);
    assert_eq!(bad.score, 0);
}

#[test]
#[should_panic(expected = "below this circle's minimum")]
fn min_trust_blocks_new_accounts() {
    ctx("ada", 0, 0);
    let mut c = Contract::new();
    ctx("ada", ONE, 0);
    let id = c.create_circle("Trusted only".into(), U128(ONE), 3, 10, Some(80));
    ctx("newbie", ONE, 1);
    c.join_circle(id);
}

#[test]
fn trusted_members_can_join_strict_circles() {
    let (mut c, id) = full_circle();
    let o = order(&c, id);
    for round in 0..3u64 {
        for who in &o {
            ctx(who, ONE, 3 + round);
            c.contribute(id);
        }
    }
    ctx("ada", ONE, 100);
    let strict = c.create_circle("Trusted only".into(), U128(ONE), 2, 10, Some(80));
    ctx("bayo", ONE, 101);
    c.join_circle(strict);
    assert_eq!(c.get_circle(strict).unwrap().status, CircleStatus::Active);
}

#[test]
fn views_list_circles() {
    let (c, id) = full_circle();
    assert_eq!(c.get_circles(None, None).len(), 1);
    assert_eq!(c.get_circles_for(acc("bayo"))[0].id, id);
    assert!(c.get_circles_for(acc("nobody")).is_empty());
    assert_eq!(c.get_trust(acc("nobody")).score, 0);
}

// ------------------------------------------------------------ stablecoin circles

const USDC: u128 = 1_000_000; // 1 tUSDC (6 decimals)

fn token_ctx(token: &str, time_ns: u64) {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(token.parse().unwrap()).block_timestamp(time_ns);
    testing_env!(b.build());
}

fn ft(c: &mut Contract, token: &str, from: &str, amount: u128, msg: &str, t: u64) {
    token_ctx(token, t);
    let _ = c.ft_on_transfer(acc(from), U128(amount), msg.to_string());
}

fn usdc_circle() -> (Contract, u32) {
    ctx("ajo", 0, 0);
    let mut c = Contract::new();
    c.set_allowed_tokens(vec!["usdc.testnet".parse().unwrap(), "usdt.testnet".parse().unwrap()]);
    ft(&mut c, "usdc.testnet", "ada", 10 * USDC,
        r#"{"action":"create","name":"Dollar circle","max_members":2,"period_minutes":60}"#, 0);
    (c, 0)
}

#[test]
fn stablecoin_circle_runs_end_to_end() {
    let (mut c, id) = usdc_circle();
    let circle = c.get_circle(id).unwrap();
    assert_eq!(circle.token.as_ref().unwrap().as_str(), "usdc.testnet");
    assert_eq!(circle.contribution.0, 10 * USDC);
    ft(&mut c, "usdc.testnet", "bayo", 10 * USDC, r#"{"action":"join","circle_id":0}"#, 1);
    assert_eq!(c.get_circle(id).unwrap().status, CircleStatus::Active);
    let members: Vec<String> = c.get_circle(id).unwrap().members.iter().map(|m| m.account_id.to_string()).collect();
    for (k, m) in members.iter().enumerate() {
        ft(&mut c, "usdc.testnet", &m.replace(".testnet", ""), 10 * USDC,
            r#"{"action":"contribute","circle_id":0}"#, 2 + k as u64);
    }
    let circle = c.get_circle(id).unwrap();
    assert_eq!(circle.history.len(), 1);
    assert_eq!(circle.history[0].amount.0, 20 * USDC);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"payout\"")));
}

#[test]
#[should_panic(expected = "Pay in this circle's currency")]
fn stablecoin_circle_rejects_other_token() {
    let (mut c, _) = usdc_circle();
    ft(&mut c, "usdt.testnet", "bayo", 10 * USDC, r#"{"action":"join","circle_id":0}"#, 1);
}

#[test]
#[should_panic(expected = "Pay in this circle's currency")]
fn stablecoin_circle_rejects_near() {
    let (mut c, _) = usdc_circle();
    ctx("bayo", 10 * USDC, 1);
    c.join_circle(0);
}

#[test]
#[should_panic(expected = "This token is not accepted")]
fn unknown_token_is_rejected() {
    let (mut c, _) = usdc_circle();
    ft(&mut c, "fake.testnet", "bayo", 10 * USDC, r#"{"action":"join","circle_id":0}"#, 1);
}

#[test]
#[should_panic(expected = "Attach exactly the circle's security deposit")]
fn stablecoin_join_needs_exact_amount() {
    let (mut c, _) = usdc_circle();
    ft(&mut c, "usdc.testnet", "bayo", 9 * USDC, r#"{"action":"join","circle_id":0}"#, 1);
}

#[test]
#[should_panic(expected = "Invalid msg")]
fn bad_msg_is_rejected() {
    let (mut c, _) = usdc_circle();
    ft(&mut c, "usdc.testnet", "bayo", 10 * USDC, "hello", 1);
}

#[test]
fn migrate_keeps_old_circles() {
    ctx("ajo", 0, 0);
    let mut old = OldContract {
        circles: Vector::new(StorageKey::Circles),
        trust: LookupMap::new(StorageKey::Trust),
    };
    old.circles.push(OldCircle {
        id: 0, name: "Old circle".into(), creator: acc("ada"), contribution: U128(ONE), deposit: U128(ONE),
        max_members: 3, period_minutes: 10, min_trust_score: 0,
        members: vec![Contract::new_member(&acc("ada"), ONE)], status: CircleStatus::Open,
        current_round: 0, round_deadline_ms: 0, pot: U128(0), history: vec![], created_at_ms: 5,
    });
    old.trust.insert(acc("ada"), TrustRecord { circles_completed: 1, on_time_payments: 4, missed_payments: 0 });
    env::state_write(&old);
    drop(old);
    let mut c = Contract::migrate(vec!["usdc.testnet".parse().unwrap()]);
    let circle = c.get_circle(0).unwrap();
    assert_eq!(circle.name, "Old circle");
    assert!(circle.token.is_none());
    assert_eq!(c.get_trust(acc("ada")).score, 100);
    assert_eq!(c.get_circle_count(), 1);
    assert_eq!(c.get_config().allowed_tokens.len(), 1);
    // the old circle still works as a NEAR circle
    ctx("bayo", ONE, 10);
    c.join_circle(0);
    assert_eq!(c.get_circle(0).unwrap().members.len(), 2);
}

// ------------------------------------------------------------ paid through the swap desk

fn desk_ctx(attached: u128, t: u64) {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id("swap.ajo.testnet".parse().unwrap())
        .current_account_id("ajo.testnet".parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(attached))
        .block_timestamp(t);
    testing_env!(b.build());
}

#[test]
fn swap_desk_pays_for_member() {
    let (mut c, id) = full_circle();
    let members: Vec<String> = c.get_circle(id).unwrap().members.iter().map(|m| m.account_id.to_string()).collect();
    for (k, m) in members.iter().enumerate() {
        desk_ctx(ONE, 10 + k as u64);
        c.pay_for(m.parse().unwrap(), format!(r#"{{"action":"contribute","circle_id":{}}}"#, id));
    }
    let circle = c.get_circle(id).unwrap();
    assert_eq!(circle.history.len(), 1);
    assert_eq!(circle.history[0].amount.0, 3 * ONE);
    assert!(circle.members.iter().all(|m| m.on_time_payments == 1));
}

#[test]
fn swap_desk_can_create_and_join() {
    ctx("ajo", 0, 0);
    let mut c = Contract::new();
    desk_ctx(ONE, 1);
    c.pay_for(acc("ada"), r#"{"action":"create","name":"Desk circle","max_members":2,"period_minutes":60}"#.into());
    desk_ctx(ONE, 2);
    c.pay_for(acc("bayo"), r#"{"action":"join","circle_id":0}"#.into());
    let circle = c.get_circle(0).unwrap();
    assert_eq!(circle.creator, acc("ada"));
    assert!(circle.token.is_none());
    assert_eq!(circle.status, CircleStatus::Active);
}

#[test]
#[should_panic(expected = "Only the swap desk")]
fn only_swap_desk_can_pay_for() {
    let (mut c, id) = full_circle();
    ctx("mallory", ONE, 10);
    c.pay_for(acc("ada"), format!(r#"{{"action":"contribute","circle_id":{}}}"#, id));
}
