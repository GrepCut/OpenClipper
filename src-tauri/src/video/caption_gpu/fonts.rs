use klyff::cosmic_text::FontSystem;
use klyff::fontdb::{Database, Query, Style, Weight};
use std::path::Path;

const CAPTION_FAMILIES: &[&str] = &[
    "Barlow Condensed",
    "Anton",
    "Dancing Script",
    "Inter",
    "Montserrat",
    "Outfit",
    "Poppins",
    "Rajdhani",
];

pub fn make_font_system(resource_fonts_dir: Option<&Path>) -> FontSystem {
    let mut db = Database::new();
    db.set_monospace_family("Consolas");
    db.set_sans_serif_family("Inter");
    db.set_serif_family("Times New Roman");

    if let Some(dir) = resource_fonts_dir {
        if dir.is_dir() {
            db.load_fonts_dir(dir);
        }
    }

    db.load_system_fonts();

    // Prefer bundled caption families when available.
    for family in CAPTION_FAMILIES {
        if query_family_id(&db, family).is_some() {
            continue;
        }
        // Windows often stores "Inter" without weight suffix; system load covers most cases.
        let _ = family;
    }

    FontSystem::new_with_locale_and_db("en-US".to_string(), db)
}

fn query_family_id(db: &Database, family: &str) -> Option<klyff::fontdb::ID> {
    db.query(&Query {
        families: &[klyff::fontdb::Family::Name(family)],
        weight: Weight::NORMAL,
        stretch: klyff::fontdb::Stretch::Normal,
        style: Style::Normal,
    })
}

pub fn static_family_name(family: &str) -> &'static str {
    match family {
        "Barlow Condensed" => "Barlow Condensed",
        "Anton" => "Anton",
        "Dancing Script" => "Dancing Script",
        "Inter" => "Inter",
        "Montserrat" => "Montserrat",
        "Outfit" => "Outfit",
        "Poppins" => "Poppins",
        "Rajdhani" => "Rajdhani",
        _ => "Inter",
    }
}

pub fn attrs_for_scene(weight: u16, italic: bool, family: &str) -> klyff::cosmic_text::Attrs<'static> {
    use klyff::cosmic_text::{Attrs, Family, Style, Weight as CosmicWeight};

    let style = if italic {
        Style::Italic
    } else {
        Style::Normal
    };
    Attrs::new()
        .family(Family::Name(static_family_name(family)))
        .weight(CosmicWeight(weight))
        .style(style)
}
