
#include "xsmc.h"
#include "xsHost.h"

#define uS_TO_S_FACTOR 1000000  /* Conversion factor for micro seconds to seconds */

void do_restart(xsMachine *the)
{
#if ESP32 
	esp_restart();
#endif
}
