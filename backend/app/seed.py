"""Seed default users and categories on first run."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Category, User

DEFAULT_USERS = ["Me", "Wife"]

DEFAULT_CATEGORIES = [
    ("Groceries", "continente,pingo doce,lidl,aldi,auchan,mercadona,intermarche,minipreco,supermarket,grocery,tesco,walmart", "#22c55e"),
    ("Dining", "restaurant,restaurante,cafe,café,pastelaria,mcdonald,burger,pizza,sushi,uber eats,glovo,bolt food,deliveroo", "#f97316"),
    ("Transport", "uber,bolt,taxi,cp comboios,metro,carris,fuel,galp,bp,repsol,shell,parking,via verde,flixbus", "#3b82f6"),
    ("Shopping", "amazon,fnac,worten,zara,h&m,ikea,decathlon,el corte,aliexpress,ebay,leroy", "#a855f7"),
    ("Utilities", "edp,endesa,galp energia,epal,aguas,meo,nos,vodafone,electric,water,internet,gas natural", "#eab308"),
    ("Entertainment", "netflix,spotify,hbo,disney,youtube,cinema,steam,playstation,xbox,nintendo,twitch,concert", "#ec4899"),
    ("Health", "farmacia,pharmacy,clinica,hospital,dentist,gym,ginásio,fitness,wells,cuf", "#14b8a6"),
    ("Housing", "rent,renda,mortgage,prestação,condominio,insurance,seguro", "#64748b"),
    ("Income", "salary,salário,vencimento,ordenado,payroll,transfer in,freelance,invoice,dividend", "#10b981"),
    ("Other", "", "#9ca3af"),
]


def categorize(description: str, categories: list[Category]) -> Category | None:
    desc = description.lower()
    for cat in categories:
        for kw in filter(None, (k.strip() for k in cat.keywords.split(","))):
            if kw in desc:
                return cat
    return None


def seed_defaults(db: Session) -> None:
    if not db.scalars(select(User)).first():
        for name in DEFAULT_USERS:
            db.add(User(name=name))
    if not db.scalars(select(Category)).first():
        for name, keywords, color in DEFAULT_CATEGORIES:
            db.add(Category(name=name, keywords=keywords, color=color))
    db.commit()
