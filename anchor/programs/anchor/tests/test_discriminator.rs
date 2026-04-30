use anchor_lang::Discriminator;

#[test]
fn print_ticket_registry_discriminator() {
    let disc = anchor::TicketRegistry::DISCRIMINATOR;
    println!("TicketRegistry discriminator: {:?}", disc);
    // Force output even on success
    panic!("DISCRIMINATOR = {:?}", disc);
}
