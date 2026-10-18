{
    "name": "Demandes de chargement",
    "summary": "Planification et suivi du chargement des camions depuis l'entrepôt",
    "version": "17.0.1.0.0",
    "category": "Inventory/Inventory",
    "license": "LGPL-3",
    "depends": ["stock", "fleet", "mail"],
    "data": [
        "security/security.xml",
        "security/ir.model.access.csv",
        "data/ir_sequence.xml",
        "views/loading_request_views.xml",
        "views/menus.xml",
        "report/loading_request_report.xml",
    ],
    "application": True,
    "installable": True,
}
