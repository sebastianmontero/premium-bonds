use std::convert::TryInto;

/// Calculate a percentage fee from an amount based on basis points (1 basis point = 0.01%).
/// 10,000 basis points equals 100%.
pub fn calculate_percentage_fee(amount: u64, fee_basis_points: u16) -> u64 {
    (amount as u128)
        .checked_mul(fee_basis_points as u128)
        .unwrap()
        .checked_div(10000)
        .unwrap()
        .try_into()
        .unwrap()
}
